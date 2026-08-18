-- Replace the Windows path before running this local-only bootstrap script.
INSERT INTO project (
    id, runtime_project_ref, name, display_root_path
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'D:\STUDY\知枢2\知枢2\claudecodeui',
    '知枢本地开发',
    'D:\STUDY\知枢2\知枢2\claudecodeui'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_profile (
    id, project_id, name, executor, connection_ref, model_alias,
    capabilities, permission_policy, timeout_seconds, prompt_version
) VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    '黄金版 Claude 开发代理',
    'claude',
    NULL,
    NULL,
    '["READ_FILE", "WRITE_FILE", "SEARCH_CODE", "SHELL", "GIT", "TEST"]'::jsonb,
    '{"requireApprovalFor": ["WRITE_FILE", "SHELL", "GIT"]}'::jsonb,
    600,
    'task-v1'
) ON CONFLICT (id) DO NOTHING;
