ALTER TABLE workspace_lease
    ADD COLUMN physical_workspace_kind TEXT NOT NULL DEFAULT 'DIRECTORY_ONLY'
        CHECK (physical_workspace_kind IN ('DIRECTORY_ONLY', 'GIT_WORKTREE')),
    ADD COLUMN repository_root TEXT,
    ADD COLUMN base_commit TEXT,
    ADD CONSTRAINT chk_workspace_lease_git_source CHECK (
        (physical_workspace_kind = 'DIRECTORY_ONLY'
            AND repository_root IS NULL AND base_commit IS NULL)
        OR
        (physical_workspace_kind = 'GIT_WORKTREE'
            AND btrim(repository_root) <> ''
            AND base_commit ~ '^[0-9a-f]{40,64}$')
    );

CREATE UNIQUE INDEX uq_active_workspace_branch
    ON workspace_lease(repository_root, branch_ref)
    WHERE physical_workspace_kind = 'GIT_WORKTREE'
      AND status IN ('RESERVED', 'PROVISIONED');

COMMENT ON COLUMN workspace_lease.physical_workspace_kind IS
    'Physical isolation fact. DIRECTORY_ONLY is a marked directory; GIT_WORKTREE is a Git-owned linked worktree.';
COMMENT ON COLUMN workspace_lease.repository_root IS
    'Canonical primary repository root frozen when a GIT_WORKTREE Schedule Proposal is created.';
COMMENT ON COLUMN workspace_lease.base_commit IS
    'Full immutable Git commit object used as the Worktree creation baseline.';

ALTER TABLE work_order
    DROP CONSTRAINT ck_work_order_schedule_execution_metadata,
    ADD CONSTRAINT ck_work_order_schedule_execution_metadata CHECK (
        (schedule_dispatch_id IS NULL AND schedule_id IS NULL AND schedule_assignment_id IS NULL
            AND workspace_lease_id IS NULL AND execution_workspace_path IS NULL)
        OR
        (schedule_dispatch_id IS NOT NULL AND schedule_id IS NOT NULL AND schedule_assignment_id IS NOT NULL
            AND workspace_lease_id IS NOT NULL AND btrim(execution_workspace_path) <> '')
    );

COMMENT ON COLUMN work_order.execution_workspace_path IS
    'Frozen Control Plane-owned DIRECTORY_ONLY or GIT_WORKTREE path used as Runtime cwd and approval root.';
