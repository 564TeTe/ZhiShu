package com.zhishu.scheduler;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.workspace.GitRepositoryInspector;

@Service
public class ParallelScheduleService {

    private static final int RECOMMENDATION_CANDIDATE_LIMIT = 500;
    private static final int RECOMMENDATION_RANK_LIMIT = 50;
    private static final String RECOMMENDATION_ORDERING_RULE =
            "ELIGIBLE_DESC_SCORE_DESC_PAIR_KEY_ASC";
    private static final String RECOMMENDATION_SCORE_MODEL = "scheduler-score-v1";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final GitRepositoryInspector gitRepositories;

    public ParallelScheduleService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            GitRepositoryInspector gitRepositories
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.gitRepositories = gitRepositories;
    }

    public ParallelScheduleView create(
            UUID projectId,
            UUID planId,
            String actor,
            String clientRequestId,
            long baseStateRevision,
            long basePlanVersion,
            List<String> requestedNodeKeys
    ) {
        return create(
                projectId, planId, actor, clientRequestId, baseStateRevision,
                basePlanVersion, requestedNodeKeys, "DIRECTORY_ONLY"
        );
    }

    public ParallelScheduleView create(
            UUID projectId,
            UUID planId,
            String actor,
            String clientRequestId,
            long baseStateRevision,
            long basePlanVersion,
            List<String> requestedNodeKeys,
            String requestedWorkspaceKind
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        List<String> nodeKeys = normalizedNodeKeys(requestedNodeKeys);
        String workspaceKind = normalizedWorkspaceKind(requestedWorkspaceKind);
        String requestHash = sha256(String.join("|", List.of(
                projectId.toString(), planId.toString(), String.valueOf(baseStateRevision),
                String.valueOf(basePlanVersion), String.join(",", nodeKeys), workspaceKind
        )));
        Optional<RequestReplay> existingReplay = findCreateReplay(
                projectId, normalizedActor, normalizedRequestId
        );
        if (existingReplay.isPresent()) {
            if (!requestHash.equals(existingReplay.get().requestHash())) {
                throw new ProjectStateConflictException(
                        "clientRequestId was reused with different Parallel Schedule content."
                );
            }
            return get(projectId, existingReplay.get().scheduleId());
        }
        GitRepositoryInspector.Snapshot gitSnapshot = "GIT_WORKTREE".equals(workspaceKind)
                ? gitRepositories.inspect(projectId) : null;
        ParallelScheduleView result = transactions.execute(status -> {
            Optional<RequestReplay> replay = findCreateReplay(projectId, normalizedActor, normalizedRequestId);
            if (replay.isPresent()) {
                if (!requestHash.equals(replay.get().requestHash())) {
                    throw new ProjectStateConflictException(
                            "clientRequestId was reused with different Parallel Schedule content."
                    );
                }
                return get(projectId, replay.get().scheduleId());
            }
            PlanSnapshot plan = lockPlan(projectId, planId);
            if (plan.stateRevision() != baseStateRevision || plan.versionNumber() != basePlanVersion) {
                throw new ProjectStateConflictException(
                        "Parallel Schedule requires the current State Revision and Plan Version."
                );
            }
            List<NodeSnapshot> nodes = nodeKeys.stream()
                    .map(nodeKey -> loadNode(plan, nodeKey))
                    .toList();
            ensureIndependent(plan.versionId(), nodes);
            ensureDisjointScopes(nodes);
            ensureNodesAvailable(planId, nodeKeys);

            UUID scheduleId = UUID.randomUUID();
            ObjectNode assessment = json.createObjectNode()
                    .put("dependency", "CLEAR")
                    .put("scope", "DISJOINT")
                    .put("workspaceIsolation", "REQUIRED")
                    .put("automaticMerge", false)
                    .put("maxWorkers", 2);
            assessment.put("physicalWorkspaceKind", workspaceKind);
            if (gitSnapshot != null) {
                assessment.put("repositoryRoot", gitSnapshot.repositoryRoot().toString());
                assessment.put("baseCommit", gitSnapshot.baseCommit());
            }
            int inserted = jdbc.update("""
                    INSERT INTO parallel_schedule_proposal (
                        id, project_id, plan_id, plan_version_id, status,
                        base_state_revision, base_plan_version, max_workers,
                        conflict_assessment, client_request_id, request_hash, created_by
                    ) VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, 2, CAST(? AS jsonb), ?, ?, ?)
                    ON CONFLICT (project_id, created_by, client_request_id) DO NOTHING
                    """, scheduleId, projectId, planId, plan.versionId(), baseStateRevision,
                    basePlanVersion, write(assessment), normalizedRequestId, requestHash, normalizedActor);
            if (inserted == 0) {
                RequestReplay concurrent = findCreateReplay(projectId, normalizedActor, normalizedRequestId)
                        .orElseThrow(() -> new IllegalStateException("Parallel Schedule replay was not found"));
                if (!requestHash.equals(concurrent.requestHash())) {
                    throw new ProjectStateConflictException(
                            "clientRequestId was reused with different Parallel Schedule content."
                    );
                }
                return get(projectId, concurrent.scheduleId());
            }
            for (int index = 0; index < nodes.size(); index += 1) {
                NodeSnapshot node = nodes.get(index);
                ProfileSnapshot profile = selectProfile(projectId, node.requiredCapabilities());
                UUID assignmentId = UUID.randomUUID();
                int workerSlot = index + 1;
                jdbc.update("""
                        INSERT INTO parallel_schedule_assignment (
                            id, schedule_id, project_id, plan_id, plan_version_id,
                            node_key, worker_slot, profile_id, status, scope,
                            required_capabilities, profile_capabilities
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', CAST(? AS jsonb),
                                  CAST(? AS jsonb), CAST(? AS jsonb))
                        """, assignmentId, scheduleId, projectId, planId, plan.versionId(),
                        node.nodeKey(), workerSlot, profile.profileId(), write(node.scope()),
                        write(node.requiredCapabilities()), write(profile.capabilities()));
                UUID leaseId = UUID.randomUUID();
                String scheduleRef = scheduleId.toString().substring(0, 8);
                jdbc.update("""
                        INSERT INTO workspace_lease (
                            id, project_id, schedule_id, assignment_id, workspace_mode,
                            physical_workspace_kind, repository_root, base_commit,
                            workspace_ref, branch_ref, status
                        ) VALUES (?, ?, ?, ?, 'ISOLATED_WORKTREE', ?, ?, ?, ?, ?, 'RESERVED')
                        """, leaseId, projectId, scheduleId, assignmentId,
                        workspaceKind,
                        gitSnapshot == null ? null : gitSnapshot.repositoryRoot().toString(),
                        gitSnapshot == null ? null : gitSnapshot.baseCommit(),
                        "workspace-lease:" + leaseId,
                        "GIT_WORKTREE".equals(workspaceKind)
                                ? "zhishu/ws/" + scheduleRef + "/" + workerSlot + "-"
                                        + leaseId.toString().substring(0, 8)
                                : "zhishu/parallel/" + scheduleRef + "/worker-" + workerSlot);
            }
            appendEvent(scheduleId, "PROPOSED", normalizedActor, assessment);
            return get(projectId, scheduleId);
        });
        if (result == null) throw new IllegalStateException("Parallel Schedule transaction returned no result");
        return result;
    }

    public List<ParallelScheduleView> list(UUID projectId, UUID planId, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                SELECT id FROM parallel_schedule_proposal
                WHERE project_id = ? AND (? IS NULL OR plan_id = ?)
                ORDER BY created_at DESC LIMIT ?
                """, (row, number) -> get(projectId, row.getObject("id", UUID.class)),
                projectId, planId, planId, boundedLimit);
    }

    public SchedulerCapabilityMatrixView capabilityMatrix(UUID projectId, UUID planId) {
        PlanSnapshot plan = readPlan(projectId, planId);
        List<ProfileSnapshot> profiles = listProfiles(projectId);
        Set<String> activeNodes = new LinkedHashSet<>(jdbc.query("""
                SELECT DISTINCT node_key FROM parallel_schedule_assignment
                WHERE plan_id = ? AND status IN ('PROPOSED', 'READY_FOR_PROVISIONING', 'PROVISIONED', 'RUNNING')
                """, (row, number) -> row.getString("node_key"), planId));
        List<MatrixNodeSnapshot> nodes = jdbc.query("""
                SELECT n.node_key, n.title, n.executable, n.scope::text AS scope,
                       n.required_capabilities::text AS required_capabilities, s.state
                FROM plan_node_definition n
                JOIN plan_execution_state s ON s.plan_id = ? AND s.node_key = n.node_key
                WHERE n.plan_version_id = ?
                ORDER BY n.priority DESC, n.node_key
                """, (row, number) -> new MatrixNodeSnapshot(
                row.getString("node_key"), row.getString("title"), row.getBoolean("executable"),
                stringArray(row.getString("scope"), "scope"),
                stringArray(row.getString("required_capabilities"), "requiredCapabilities"),
                row.getString("state")
        ), planId, plan.versionId());

        List<SchedulerCapabilityMatrixView.ProfileView> profileViews = profiles.stream()
                .map(profile -> new SchedulerCapabilityMatrixView.ProfileView(
                        profile.profileId(), profile.name(), profile.executor(), profile.enabled(), profile.capabilities()
                )).toList();
        List<SchedulerCapabilityMatrixView.NodeView> nodeViews = nodes.stream()
                .map(node -> matrixNode(node, profiles, activeNodes.contains(node.nodeKey())))
                .toList();
        int schedulableCount = (int) nodeViews.stream().filter(SchedulerCapabilityMatrixView.NodeView::schedulable).count();
        int enabledProfileCount = (int) profiles.stream().filter(ProfileSnapshot::enabled).count();
        return new SchedulerCapabilityMatrixView(
                projectId, planId, plan.versionId(), "1.0", plan.stateRevision(), plan.versionNumber(), 2,
                new SchedulerCapabilityMatrixView.SummaryView(
                        profiles.size(), enabledProfileCount, nodeViews.size(), schedulableCount,
                        nodeViews.size() - schedulableCount
                ),
                List.copyOf(profileViews), List.copyOf(nodeViews), Instant.now()
        );
    }

    public SchedulerCandidatePairMatrixView candidatePairs(UUID projectId, UUID planId, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 500));
        SchedulerCapabilityMatrixView matrix = capabilityMatrix(projectId, planId);
        Set<DependencyEdge> dependencies = dependencyReachability(matrix.planVersionId());
        List<SchedulerCandidatePairMatrixView.CandidatePairView> candidates = new ArrayList<>();
        List<SchedulerCapabilityMatrixView.NodeView> nodes = matrix.nodes();

        outer:
        for (int leftIndex = 0; leftIndex < nodes.size(); leftIndex += 1) {
            for (int rightIndex = leftIndex + 1; rightIndex < nodes.size(); rightIndex += 1) {
                candidates.add(candidatePair(nodes.get(leftIndex), nodes.get(rightIndex), dependencies));
                if (candidates.size() == boundedLimit) break outer;
            }
        }

        long totalPairCount = ((long) nodes.size() * (nodes.size() - 1)) / 2;
        int eligiblePairCount = (int) candidates.stream()
                .filter(SchedulerCandidatePairMatrixView.CandidatePairView::eligible)
                .count();
        return new SchedulerCandidatePairMatrixView(
                matrix.projectId(), matrix.planId(), matrix.planVersionId(), "1.0",
                matrix.baseStateRevision(), matrix.basePlanVersion(), matrix.maxWorkers(),
                new SchedulerCandidatePairMatrixView.SummaryView(
                        nodes.size(), totalPairCount, candidates.size(), eligiblePairCount,
                        candidates.size() - eligiblePairCount, candidates.size() < totalPairCount
                ),
                List.copyOf(candidates), Instant.now()
        );
    }

    public SchedulerRecommendationView recommendation(UUID projectId, UUID planId) {
        SchedulerCandidatePairMatrixView matrix = candidatePairs(projectId, planId, RECOMMENDATION_CANDIDATE_LIMIT);
        Map<String, Integer> priorities = nodePriorities(matrix.planVersionId());
        List<ScoredCandidate> scored = matrix.candidates().stream()
                .map(candidate -> scoreCandidate(candidate, priorities))
                .sorted(Comparator.comparing(ScoredCandidate::eligible).reversed()
                        .thenComparing(ScoredCandidate::score, Comparator.reverseOrder())
                        .thenComparing(ScoredCandidate::pairKey))
                .toList();

        List<SchedulerRecommendationView.RankedCandidateView> ranked = new ArrayList<>();
        for (int index = 0; index < Math.min(scored.size(), RECOMMENDATION_RANK_LIMIT); index += 1) {
            ScoredCandidate candidate = scored.get(index);
            ranked.add(new SchedulerRecommendationView.RankedCandidateView(
                    index + 1, candidate.pairKey(), candidate.leftNodeKey(), candidate.rightNodeKey(),
                    candidate.eligible(), candidate.score(), candidate.breakdown(), candidate.reasons(),
                    candidate.blockers()
            ));
        }

        SchedulerRecommendationView.RecommendationView recommendation;
        if (matrix.summary().truncated()) {
            recommendation = new SchedulerRecommendationView.RecommendationView(
                    "EVALUATION_TRUNCATED", null, null, null,
                    List.of("Candidate evaluation was truncated; a complete recommendation is unavailable.")
            );
        } else {
            Optional<ScoredCandidate> preferred = scored.stream().filter(ScoredCandidate::eligible).findFirst();
            recommendation = preferred
                    .map(candidate -> new SchedulerRecommendationView.RecommendationView(
                            "RECOMMENDED", candidate.pairKey(), 1, candidate.score(),
                            append(candidate.reasons(), "Highest deterministic score among eligible candidates.")
                    ))
                    .orElseGet(() -> new SchedulerRecommendationView.RecommendationView(
                            "NO_ELIGIBLE_CANDIDATE", null, null, null,
                            List.of("No eligible Parallel Schedule candidate is currently available.")
                    ));
        }

        String recommendationFingerprint = sha256(String.join("|", List.of(
                matrix.planVersionId().toString(), String.valueOf(matrix.basePlanVersion()),
                String.valueOf(matrix.baseStateRevision()), String.valueOf(matrix.summary().evaluatedPairCount()),
                String.valueOf(matrix.summary().truncated()),
                String.join("|", scored.stream()
                        .map(candidate -> candidate.pairKey() + ":" + candidate.score()
                                + ":" + candidate.eligible())
                        .toList())
        )));
        return new SchedulerRecommendationView(
                matrix.projectId(), matrix.planId(), matrix.planVersionId(), "1.0",
                matrix.baseStateRevision(), matrix.basePlanVersion(), matrix.maxWorkers(),
                recommendationFingerprint,
                new SchedulerRecommendationView.BaselineView(
                        matrix.planVersionId(), matrix.basePlanVersion(), matrix.baseStateRevision(),
                        "CURRENT_SNAPSHOT"
                ),
                new SchedulerRecommendationView.DeterminismView(
                        RECOMMENDATION_ORDERING_RULE, RECOMMENDATION_SCORE_MODEL,
                        RECOMMENDATION_CANDIDATE_LIMIT, RECOMMENDATION_RANK_LIMIT, true
                ),
                new SchedulerRecommendationView.SummaryView(
                        matrix.summary().evaluatedPairCount(), matrix.summary().eligiblePairCount(),
                        matrix.summary().blockedPairCount(), ranked.size(), matrix.summary().truncated()
                ),
                recommendation, List.copyOf(ranked), Instant.now()
        );
    }

    public ParallelScheduleView get(UUID projectId, UUID scheduleId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT id, project_id, plan_id, plan_version_id, schema_version, status,
                           base_state_revision, base_plan_version, max_workers,
                           conflict_assessment::text AS conflict_assessment,
                           client_request_id, created_by, created_at,
                           decided_by, decided_at, decision_reason
                    FROM parallel_schedule_proposal WHERE id = ? AND project_id = ?
                    """, scheduleId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Parallel Schedule Proposal was not found.");
        }
        List<ParallelScheduleView.AssignmentView> assignments = jdbc.query("""
                SELECT a.id, a.node_key, a.worker_slot, a.profile_id, p.name AS profile_name,
                       p.executor, a.status, a.scope::text AS scope,
                       a.required_capabilities::text AS required_capabilities,
                       a.profile_capabilities::text AS profile_capabilities,
                        l.id AS lease_id, l.workspace_mode, l.physical_workspace_kind,
                        l.workspace_ref, l.branch_ref,
                       l.status AS lease_status, l.provisioning_state, l.workspace_path,
                       l.lease_expires_at, l.provisioning_started_at, l.provisioned_at,
                       l.failure_code, l.failure_message, l.cleaned_at,
                       l.created_at AS lease_created_at, l.released_at
                FROM parallel_schedule_assignment a
                JOIN agent_profile p ON p.id = a.profile_id
                JOIN workspace_lease l ON l.assignment_id = a.id
                WHERE a.schedule_id = ? ORDER BY a.worker_slot
                """, this::mapAssignment, scheduleId);
        List<ParallelScheduleView.EventView> events = jdbc.query("""
                SELECT id, event_type, actor, payload::text AS payload, occurred_at
                FROM parallel_schedule_event WHERE schedule_id = ? ORDER BY id
                """, (event, number) -> new ParallelScheduleView.EventView(
                        event.getLong("id"), event.getString("event_type"), event.getString("actor"),
                        read(event.getString("payload")), event.getTimestamp("occurred_at").toInstant()
                ), scheduleId);
        return new ParallelScheduleView(
                (UUID) row.get("id"), (UUID) row.get("project_id"), (UUID) row.get("plan_id"),
                (UUID) row.get("plan_version_id"), String.valueOf(row.get("schema_version")),
                String.valueOf(row.get("status")), ((Number) row.get("base_state_revision")).longValue(),
                ((Number) row.get("base_plan_version")).longValue(), ((Number) row.get("max_workers")).intValue(),
                read(String.valueOf(row.get("conflict_assessment"))), String.valueOf(row.get("client_request_id")),
                String.valueOf(row.get("created_by")), ((Timestamp) row.get("created_at")).toInstant(),
                nullable(row.get("decided_by")), instant(row.get("decided_at")), nullable(row.get("decision_reason")),
                List.copyOf(assignments), List.copyOf(events)
        );
    }

    public ParallelScheduleView confirm(
            UUID projectId,
            UUID planId,
            UUID scheduleId,
            String actor,
            String clientRequestId
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String decisionHash = sha256(scheduleId + "|CONFIRM");
        ParallelScheduleView decisionReplay = findDecisionReplay(
                projectId, planId, normalizedActor, normalizedRequestId, decisionHash, scheduleId
        );
        if (decisionReplay != null) return decisionReplay;
        try {
            ParallelScheduleView result = transactions.execute(status -> {
                Map<String, Object> row = lockSchedule(projectId, planId, scheduleId);
                if (!"PENDING_APPROVAL".equals(row.get("status"))) {
                    throw new ProjectStateConflictException("Parallel Schedule Proposal is no longer pending.");
                }
                PlanSnapshot plan = lockPlan(projectId, (UUID) row.get("plan_id"));
                if (!plan.versionId().equals(row.get("plan_version_id"))
                        || plan.stateRevision() != ((Number) row.get("base_state_revision")).longValue()) {
                    throw new ProjectStateConflictException("Parallel Schedule Proposal is stale.");
                }
                Instant now = Instant.now();
                jdbc.update("""
                        UPDATE parallel_schedule_proposal
                        SET status = 'APPROVED', decided_by = ?, decided_at = ?,
                            decision_request_id = ?, decision_hash = ?
                        WHERE id = ?
                        """, normalizedActor, Timestamp.from(now), normalizedRequestId,
                        decisionHash, scheduleId);
                jdbc.update("""
                        UPDATE parallel_schedule_assignment
                        SET status = 'READY_FOR_PROVISIONING', updated_at = now()
                        WHERE schedule_id = ? AND status = 'PROPOSED'
                        """, scheduleId);
                appendEvent(scheduleId, "APPROVED", normalizedActor,
                        json.createObjectNode().put("clientRequestId", normalizedRequestId));
                return get(projectId, scheduleId);
            });
            if (result == null) throw new IllegalStateException("Parallel Schedule confirmation returned no result");
            return result;
        } catch (ProjectStateConflictException error) {
            if ("Parallel Schedule Proposal is stale.".equals(error.getMessage())) {
                markStale(projectId, planId, scheduleId);
            }
            throw error;
        }
    }

    public ParallelScheduleView reject(
            UUID projectId,
            UUID planId,
            UUID scheduleId,
            String actor,
            String clientRequestId,
            String reason
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String normalizedReason = requireText(reason, "reason");
        String decisionHash = sha256(scheduleId + "|REJECT|" + normalizedReason);
        ParallelScheduleView decisionReplay = findDecisionReplay(
                projectId, planId, normalizedActor, normalizedRequestId, decisionHash, scheduleId
        );
        if (decisionReplay != null) return decisionReplay;
        ParallelScheduleView result = transactions.execute(status -> {
            Map<String, Object> row = lockSchedule(projectId, planId, scheduleId);
            if (!"PENDING_APPROVAL".equals(row.get("status"))) {
                throw new ProjectStateConflictException("Parallel Schedule Proposal is no longer pending.");
            }
            Instant now = Instant.now();
            jdbc.update("""
                    UPDATE parallel_schedule_proposal
                    SET status = 'REJECTED', decided_by = ?, decided_at = ?,
                        decision_request_id = ?, decision_hash = ?, decision_reason = ?
                    WHERE id = ?
                    """, normalizedActor, Timestamp.from(now), normalizedRequestId,
                    decisionHash, normalizedReason, scheduleId);
            releaseAssignments(scheduleId);
            appendEvent(scheduleId, "REJECTED", normalizedActor, json.createObjectNode()
                    .put("clientRequestId", normalizedRequestId).put("reason", normalizedReason));
            return get(projectId, scheduleId);
        });
        if (result == null) throw new IllegalStateException("Parallel Schedule rejection returned no result");
        return result;
    }

    private PlanSnapshot lockPlan(UUID projectId, UUID planId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT p.current_version_id, v.version_number, s.state_revision
                    FROM project_plan p
                    JOIN plan_version v ON v.id = p.current_version_id
                    JOIN project_state_snapshot s ON s.project_id = p.project_id
                    WHERE p.id = ? AND p.project_id = ? AND p.status = 'ACTIVE'
                    FOR UPDATE OF p
                    """, planId, projectId);
            return new PlanSnapshot(
                    (UUID) row.get("current_version_id"),
                    ((Number) row.get("version_number")).longValue(),
                    ((Number) row.get("state_revision")).longValue()
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Active Plan was not found for Parallel Schedule.");
        }
    }

    private PlanSnapshot readPlan(UUID projectId, UUID planId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT p.current_version_id, v.version_number, s.state_revision
                    FROM project_plan p
                    JOIN plan_version v ON v.id = p.current_version_id
                    JOIN project_state_snapshot s ON s.project_id = p.project_id
                    WHERE p.id = ? AND p.project_id = ? AND p.status = 'ACTIVE'
                    """, planId, projectId);
            return new PlanSnapshot(
                    (UUID) row.get("current_version_id"),
                    ((Number) row.get("version_number")).longValue(),
                    ((Number) row.get("state_revision")).longValue()
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Active Plan was not found for Scheduler Capability Matrix.");
        }
    }

    private NodeSnapshot loadNode(PlanSnapshot plan, String nodeKey) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT n.node_key, n.scope::text AS scope,
                           n.required_capabilities::text AS required_capabilities,
                           n.executable, s.state
                    FROM plan_node_definition n
                    JOIN project_plan p ON p.current_version_id = n.plan_version_id
                    JOIN plan_execution_state s ON s.plan_id = p.id AND s.node_key = n.node_key
                    WHERE n.plan_version_id = ? AND n.node_key = ?
                    """, plan.versionId(), nodeKey);
            if (!Boolean.TRUE.equals(row.get("executable")) || !"READY".equals(row.get("state"))) {
                throw new ProjectStateConflictException(
                        "Parallel Schedule requires executable READY nodes: " + nodeKey
                );
            }
            return new NodeSnapshot(
                    nodeKey, stringArray(String.valueOf(row.get("scope")), "scope"),
                    stringArray(String.valueOf(row.get("required_capabilities")), "requiredCapabilities")
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Plan node was not found: " + nodeKey);
        }
    }

    private void ensureIndependent(UUID versionId, List<NodeSnapshot> nodes) {
        Set<DependencyEdge> dependencies = dependencyReachability(versionId);
        if (dependencies.contains(new DependencyEdge(nodes.get(0).nodeKey(), nodes.get(1).nodeKey()))
                || dependencies.contains(new DependencyEdge(nodes.get(1).nodeKey(), nodes.get(0).nodeKey()))) {
            throw new ProjectStateConflictException("Parallel Schedule nodes must not depend on each other.");
        }
    }

    private void ensureDisjointScopes(List<NodeSnapshot> nodes) {
        List<String> left = scopeRoots(nodes.get(0));
        List<String> right = scopeRoots(nodes.get(1));
        for (String first : left) {
            for (String second : right) {
                if (first.equals(second) || first.startsWith(second + "/") || second.startsWith(first + "/")) {
                    throw new ProjectStateConflictException(
                            "Parallel Schedule scope conflict: " + first + " overlaps " + second
                    );
                }
            }
        }
    }

    private List<String> scopeRoots(NodeSnapshot node) {
        ScopeNormalization normalization = normalizeScope(node.scope());
        if ("MISSING".equals(normalization.status())) {
            throw new ProjectStateConflictException(
                    "Parallel Schedule requires explicit file scopes: " + node.nodeKey()
            );
        }
        if ("TOO_BROAD".equals(normalization.status())) {
            throw new ProjectStateConflictException(
                    "Parallel Schedule scope is too broad: " + node.nodeKey()
            );
        }
        return normalization.roots();
    }

    private ScopeNormalization normalizeScope(List<String> scope) {
        if (scope.isEmpty()) return new ScopeNormalization("MISSING", List.of());
        List<String> roots = new ArrayList<>();
        boolean tooBroad = false;
        for (String value : scope) {
            String normalized = value.trim().replace('\\', '/').toLowerCase(Locale.ROOT);
            while (normalized.startsWith("./")) normalized = normalized.substring(2);
            int wildcard = Math.min(indexOrLength(normalized, '*'), indexOrLength(normalized, '?'));
            if (wildcard < normalized.length()) normalized = normalized.substring(0, wildcard);
            normalized = normalized.replaceAll("/+$", "");
            if (normalized.isBlank() || ".".equals(normalized) || "/".equals(normalized)) {
                tooBroad = true;
            } else {
                roots.add(normalized);
            }
        }
        return new ScopeNormalization(
                tooBroad ? "TOO_BROAD" : "VALID",
                roots.stream().distinct().sorted().toList()
        );
    }

    private int indexOrLength(String value, char character) {
        int index = value.indexOf(character);
        return index < 0 ? value.length() : index;
    }

    private void ensureNodesAvailable(UUID planId, List<String> nodeKeys) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM parallel_schedule_assignment
                WHERE plan_id = ? AND node_key IN (?, ?)
                  AND status IN ('PROPOSED', 'READY_FOR_PROVISIONING', 'PROVISIONED', 'RUNNING')
                """, Integer.class, planId, nodeKeys.get(0), nodeKeys.get(1));
        if (count != null && count > 0) {
            throw new ProjectStateConflictException("A selected Plan node already has an active Parallel Schedule.");
        }
    }

    private ProfileSnapshot selectProfile(UUID projectId, List<String> requiredCapabilities) {
        List<ProfileSnapshot> profiles = listProfiles(projectId);
        Set<String> required = new LinkedHashSet<>(requiredCapabilities);
        return profiles.stream()
                .filter(ProfileSnapshot::enabled)
                .filter(profile -> new LinkedHashSet<>(profile.capabilities()).containsAll(required))
                .findFirst()
                .orElseThrow(() -> new ProjectStateConflictException(
                        "No enabled Agent Profile satisfies Parallel Schedule capabilities: "
                                + String.join(", ", requiredCapabilities)
                ));
    }

    private List<ProfileSnapshot> listProfiles(UUID projectId) {
        return jdbc.query("""
                SELECT id, name, executor, enabled, capabilities::text AS capabilities
                FROM agent_profile WHERE project_id = ?
                ORDER BY enabled DESC, name, id
                """, (row, number) -> new ProfileSnapshot(
                row.getObject("id", UUID.class), row.getString("name"), row.getString("executor"),
                row.getBoolean("enabled"), stringArray(row.getString("capabilities"), "profile.capabilities")
        ), projectId);
    }

    private SchedulerCapabilityMatrixView.NodeView matrixNode(
            MatrixNodeSnapshot node,
            List<ProfileSnapshot> profiles,
            boolean activeSchedule
    ) {
        List<SchedulerCapabilityMatrixView.ProfileMatchView> matches = profiles.stream()
                .map(profile -> {
                    List<String> missing = node.requiredCapabilities().stream()
                            .filter(required -> !profile.capabilities().contains(required)).toList();
                    return new SchedulerCapabilityMatrixView.ProfileMatchView(
                            profile.profileId(), profile.name(), profile.executor(), profile.enabled(),
                            profile.capabilities(), missing, profile.enabled() && missing.isEmpty()
                    );
                }).toList();
        int eligibleCount = (int) matches.stream().filter(SchedulerCapabilityMatrixView.ProfileMatchView::eligible).count();
        List<String> blockers = new ArrayList<>();
        if (!node.executable()) blockers.add("NODE_NOT_EXECUTABLE");
        if (!"READY".equals(node.executionState())) blockers.add("NODE_NOT_READY");
        if (node.scope().isEmpty()) blockers.add("SCOPE_MISSING");
        if (eligibleCount == 0) blockers.add("CAPABILITY_UNSATISFIED");
        if (activeSchedule) blockers.add("ACTIVE_SCHEDULE_EXISTS");
        return new SchedulerCapabilityMatrixView.NodeView(
                node.nodeKey(), node.title(), node.executionState(), node.executable(), node.scope(),
                node.requiredCapabilities(), eligibleCount, blockers.isEmpty(), activeSchedule,
                List.copyOf(blockers), List.copyOf(matches)
        );
    }

    private SchedulerCandidatePairMatrixView.CandidatePairView candidatePair(
            SchedulerCapabilityMatrixView.NodeView left,
            SchedulerCapabilityMatrixView.NodeView right,
            Set<DependencyEdge> dependencies
    ) {
        boolean leftDependsOnRight = dependencies.contains(new DependencyEdge(left.nodeKey(), right.nodeKey()));
        boolean rightDependsOnLeft = dependencies.contains(new DependencyEdge(right.nodeKey(), left.nodeKey()));
        String dependencyDirection = leftDependsOnRight && rightDependsOnLeft
                ? "BIDIRECTIONAL"
                : leftDependsOnRight
                        ? "LEFT_DEPENDS_ON_RIGHT"
                        : rightDependsOnLeft ? "RIGHT_DEPENDS_ON_LEFT" : "NONE";
        String dependencyAssessment = "NONE".equals(dependencyDirection) ? "CLEAR" : "CONFLICT";
        PairScopeAssessment scope = assessPairScope(left.scope(), right.scope());
        List<String> blockers = new ArrayList<>();
        if (!left.schedulable()) blockers.add("LEFT_NODE_BLOCKED");
        if (!right.schedulable()) blockers.add("RIGHT_NODE_BLOCKED");
        if ("CONFLICT".equals(dependencyAssessment)) blockers.add("DEPENDENCY_CONFLICT");
        if ("OVERLAP".equals(scope.status())) blockers.add("SCOPE_OVERLAP");
        if ("MISSING".equals(scope.status())) blockers.add("SCOPE_MISSING");
        if ("TOO_BROAD".equals(scope.status())) blockers.add("SCOPE_TOO_BROAD");
        return new SchedulerCandidatePairMatrixView.CandidatePairView(
                left.nodeKey() + "::" + right.nodeKey(), candidateNode(left), candidateNode(right),
                dependencyAssessment, dependencyDirection, scope.status(), scope.conflicts(),
                "REQUIRED", left.activeSchedule() || right.activeSchedule(), blockers.isEmpty(),
                List.copyOf(blockers)
        );
    }

    private ScoredCandidate scoreCandidate(
            SchedulerCandidatePairMatrixView.CandidatePairView candidate,
            Map<String, Integer> priorities
    ) {
        boolean nodesReady = candidate.leftNode().schedulable() && candidate.rightNode().schedulable();
        boolean profilesMatched = candidate.leftNode().matchedProfile() != null
                && candidate.rightNode().matchedProfile() != null;
        long eligibility = candidate.eligible() ? 1_000_000L : 0L;
        long nodeReadiness = nodesReady ? 10_000L : 0L;
        long planPriority = 100L * (
                priorities.getOrDefault(candidate.leftNode().nodeKey(), 0)
                        + priorities.getOrDefault(candidate.rightNode().nodeKey(), 0)
        );
        long dependency = "CLEAR".equals(candidate.dependencyAssessment()) ? 1_000L : 0L;
        long scope = "DISJOINT".equals(candidate.scopeAssessment()) ? 1_000L : 0L;
        long profileMatch = profilesMatched ? 500L : 0L;
        long scheduleAvailability = candidate.activeScheduleConflict() ? 0L : 500L;
        long blockerPenalty = -10_000L * candidate.blockers().size();
        SchedulerRecommendationView.ScoreBreakdownView breakdown =
                new SchedulerRecommendationView.ScoreBreakdownView(
                        eligibility, nodeReadiness, planPriority, dependency, scope,
                        profileMatch, scheduleAvailability, blockerPenalty
                );
        long score = eligibility + nodeReadiness + planPriority + dependency + scope
                + profileMatch + scheduleAvailability + blockerPenalty;
        List<String> reasons = new ArrayList<>();
        if (nodesReady) reasons.add("Both nodes are currently schedulable.");
        if ("CLEAR".equals(candidate.dependencyAssessment())) reasons.add("No dependency relation blocks the pair.");
        if ("DISJOINT".equals(candidate.scopeAssessment())) reasons.add("Normalized scopes are disjoint.");
        if (profilesMatched) reasons.add("Both nodes have deterministic eligible Profile matches.");
        if (!candidate.activeScheduleConflict()) reasons.add("Neither node is reserved by an active Schedule.");
        reasons.add("Combined Plan priority is " + planPriority / 100L + ".");
        if (!candidate.eligible()) reasons.add("Blocked by: " + String.join(", ", candidate.blockers()) + ".");
        return new ScoredCandidate(
                candidate.pairKey(), candidate.leftNode().nodeKey(), candidate.rightNode().nodeKey(),
                candidate.eligible(), score, breakdown, List.copyOf(reasons), candidate.blockers()
        );
    }

    private Map<String, Integer> nodePriorities(UUID versionId) {
        Map<String, Integer> priorities = new LinkedHashMap<>();
        jdbc.query("""
                SELECT node_key, priority FROM plan_node_definition
                WHERE plan_version_id = ? ORDER BY priority DESC, node_key
                """, (row, number) -> Map.entry(
                row.getString("node_key"), row.getInt("priority")
        ), versionId).forEach(entry -> priorities.put(entry.getKey(), entry.getValue()));
        return priorities;
    }

    private List<String> append(List<String> values, String value) {
        List<String> result = new ArrayList<>(values);
        result.add(value);
        return List.copyOf(result);
    }

    private SchedulerCandidatePairMatrixView.CandidateNodeView candidateNode(
            SchedulerCapabilityMatrixView.NodeView node
    ) {
        SchedulerCandidatePairMatrixView.MatchedProfileView matchedProfile = node.profileMatches().stream()
                .filter(SchedulerCapabilityMatrixView.ProfileMatchView::eligible)
                .findFirst()
                .map(profile -> new SchedulerCandidatePairMatrixView.MatchedProfileView(
                        profile.profileId(), profile.profileName(), profile.executor()
                ))
                .orElse(null);
        return new SchedulerCandidatePairMatrixView.CandidateNodeView(
                node.nodeKey(), node.title(), node.executionState(), node.scope(), node.requiredCapabilities(),
                matchedProfile, node.schedulable(), node.blockers()
        );
    }

    private PairScopeAssessment assessPairScope(List<String> leftScope, List<String> rightScope) {
        ScopeNormalization left = normalizeScope(leftScope);
        ScopeNormalization right = normalizeScope(rightScope);
        if ("MISSING".equals(left.status()) || "MISSING".equals(right.status())) {
            return new PairScopeAssessment("MISSING", List.of());
        }
        if ("TOO_BROAD".equals(left.status()) || "TOO_BROAD".equals(right.status())) {
            return new PairScopeAssessment("TOO_BROAD", List.of());
        }
        List<SchedulerCandidatePairMatrixView.ScopeConflictView> conflicts = new ArrayList<>();
        for (String leftRoot : left.roots()) {
            for (String rightRoot : right.roots()) {
                if (leftRoot.equals(rightRoot)
                        || leftRoot.startsWith(rightRoot + "/")
                        || rightRoot.startsWith(leftRoot + "/")) {
                    conflicts.add(new SchedulerCandidatePairMatrixView.ScopeConflictView(leftRoot, rightRoot));
                }
            }
        }
        return new PairScopeAssessment(conflicts.isEmpty() ? "DISJOINT" : "OVERLAP", List.copyOf(conflicts));
    }

    private Set<DependencyEdge> dependencyReachability(UUID versionId) {
        return new LinkedHashSet<>(jdbc.query("""
                WITH RECURSIVE reach(node_key, dependency) AS (
                    SELECT node_key, depends_on_node_key FROM plan_node_dependency
                    WHERE plan_version_id = ?
                    UNION
                    SELECT reach.node_key, dependency.depends_on_node_key
                    FROM reach
                    JOIN plan_node_dependency dependency
                      ON dependency.plan_version_id = ?
                     AND dependency.node_key = reach.dependency
                )
                SELECT node_key, dependency FROM reach
                """, (row, number) -> new DependencyEdge(
                row.getString("node_key"), row.getString("dependency")
        ), versionId, versionId));
    }

    private Map<String, Object> lockSchedule(UUID projectId, UUID planId, UUID scheduleId) {
        try {
            return jdbc.queryForMap("""
                    SELECT id, plan_id, plan_version_id, status, base_state_revision
                    FROM parallel_schedule_proposal
                    WHERE id = ? AND project_id = ? AND plan_id = ? FOR UPDATE
                    """, scheduleId, projectId, planId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Parallel Schedule Proposal was not found.");
        }
    }

    private void markStale(UUID projectId, UUID planId, UUID scheduleId) {
        transactions.executeWithoutResult(status -> {
            int updated = jdbc.update("""
                    UPDATE parallel_schedule_proposal
                    SET status = 'STALE', decided_at = now(), decision_reason = 'State or Plan version changed'
                    WHERE id = ? AND project_id = ? AND plan_id = ? AND status = 'PENDING_APPROVAL'
                    """, scheduleId, projectId, planId);
            if (updated == 1) {
                releaseAssignments(scheduleId);
                appendEvent(scheduleId, "STALE", "system:scheduler", json.createObjectNode());
            }
        });
    }

    private void releaseAssignments(UUID scheduleId) {
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'CANCELLED', updated_at = now()
                WHERE schedule_id = ? AND status IN ('PROPOSED', 'READY_FOR_PROVISIONING')
                """, scheduleId);
        jdbc.update("""
                UPDATE workspace_lease
                SET status = 'RELEASED', released_at = now(), updated_at = now()
                WHERE schedule_id = ? AND status = 'RESERVED'
                """, scheduleId);
    }

    private Optional<RequestReplay> findCreateReplay(UUID projectId, String actor, String clientRequestId) {
        try {
            return Optional.ofNullable(jdbc.queryForObject("""
                    SELECT id, request_hash FROM parallel_schedule_proposal
                    WHERE project_id = ? AND created_by = ? AND client_request_id = ?
                    """, (row, number) -> new RequestReplay(
                            row.getObject("id", UUID.class), row.getString("request_hash")
                    ), projectId, actor, clientRequestId));
        } catch (EmptyResultDataAccessException error) {
            return Optional.empty();
        }
    }

    private ParallelScheduleView findDecisionReplay(
            UUID projectId,
            UUID planId,
            String actor,
            String clientRequestId,
            String decisionHash,
            UUID scheduleId
    ) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, plan_id, decision_hash FROM parallel_schedule_proposal
                    WHERE project_id = ? AND decided_by = ? AND decision_request_id = ?
                    """, (row, number) -> {
                UUID existingId = row.getObject("id", UUID.class);
                UUID existingPlanId = row.getObject("plan_id", UUID.class);
                if (!existingPlanId.equals(planId) || !existingId.equals(scheduleId)
                        || !decisionHash.equals(row.getString("decision_hash"))) {
                    throw new ProjectStateConflictException(
                            "clientRequestId was reused with a different Parallel Schedule decision."
                    );
                }
                return get(projectId, existingId);
            }, projectId, actor, clientRequestId);
        } catch (EmptyResultDataAccessException error) {
            return null;
        }
    }

    private ParallelScheduleView.AssignmentView mapAssignment(ResultSet row, int number) throws SQLException {
        Timestamp releasedAt = row.getTimestamp("released_at");
        ParallelScheduleView.WorkspaceLeaseView lease = new ParallelScheduleView.WorkspaceLeaseView(
                row.getObject("lease_id", UUID.class), row.getString("workspace_mode"),
                row.getString("physical_workspace_kind"),
                row.getString("workspace_ref"), row.getString("branch_ref"), row.getString("lease_status"),
                row.getString("provisioning_state"), row.getString("workspace_path"),
                instant(row.getTimestamp("lease_expires_at")),
                instant(row.getTimestamp("provisioning_started_at")),
                instant(row.getTimestamp("provisioned_at")), row.getString("failure_code"),
                row.getString("failure_message"), instant(row.getTimestamp("cleaned_at")),
                row.getTimestamp("lease_created_at").toInstant(),
                releasedAt == null ? null : releasedAt.toInstant()
        );
        return new ParallelScheduleView.AssignmentView(
                row.getObject("id", UUID.class), row.getString("node_key"), row.getInt("worker_slot"),
                row.getObject("profile_id", UUID.class), row.getString("profile_name"), row.getString("executor"),
                row.getString("status"), read(row.getString("scope")),
                read(row.getString("required_capabilities")), read(row.getString("profile_capabilities")), lease
        );
    }

    private void appendEvent(UUID scheduleId, String eventType, String actor, JsonNode payload) {
        jdbc.update("""
                INSERT INTO parallel_schedule_event (schedule_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, scheduleId, eventType, actor, write(payload));
    }

    private List<String> normalizedNodeKeys(List<String> values) {
        if (values == null) throw new IllegalArgumentException("nodeKeys are required");
        List<String> result = values.stream().map(value -> requireText(value, "nodeKey"))
                .distinct().sorted(Comparator.naturalOrder()).toList();
        if (result.size() != 2) {
            throw new IllegalArgumentException("Stage 10.1 requires exactly two distinct nodeKeys.");
        }
        return result;
    }

    private String normalizedWorkspaceKind(String value) {
        String normalized = value == null || value.isBlank()
                ? "DIRECTORY_ONLY" : value.trim().toUpperCase(Locale.ROOT);
        if (!List.of("DIRECTORY_ONLY", "GIT_WORKTREE").contains(normalized)) {
            throw new IllegalArgumentException(
                    "physicalWorkspaceKind must be DIRECTORY_ONLY or GIT_WORKTREE."
            );
        }
        return normalized;
    }

    private List<String> stringArray(String value, String field) {
        JsonNode node = read(value);
        if (!node.isArray()) throw new IllegalStateException(field + " must be a JSON array");
        List<String> result = new ArrayList<>();
        node.forEach(item -> result.add(requireText(item.asText(), field)));
        return List.copyOf(result);
    }

    private String nullable(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Instant instant(Object value) {
        return value instanceof Timestamp timestamp ? timestamp.toInstant() : null;
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Parallel Schedule JSON serialization failed", error);
        }
    }

    private JsonNode read(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Parallel Schedule JSON is unreadable", error);
        }
    }

    private record PlanSnapshot(UUID versionId, long versionNumber, long stateRevision) {
    }

    private record NodeSnapshot(String nodeKey, List<String> scope, List<String> requiredCapabilities) {
    }

    private record MatrixNodeSnapshot(
            String nodeKey,
            String title,
            boolean executable,
            List<String> scope,
            List<String> requiredCapabilities,
            String executionState
    ) {
    }

    private record ProfileSnapshot(
            UUID profileId,
            String name,
            String executor,
            boolean enabled,
            List<String> capabilities
    ) {
    }

    private record DependencyEdge(String nodeKey, String dependency) {
    }

    private record ScopeNormalization(String status, List<String> roots) {
    }

    private record PairScopeAssessment(
            String status,
            List<SchedulerCandidatePairMatrixView.ScopeConflictView> conflicts
    ) {
    }

    private record ScoredCandidate(
            String pairKey,
            String leftNodeKey,
            String rightNodeKey,
            boolean eligible,
            Long score,
            SchedulerRecommendationView.ScoreBreakdownView breakdown,
            List<String> reasons,
            List<String> blockers
    ) {
    }

    private record RequestReplay(UUID scheduleId, String requestHash) {
    }
}
