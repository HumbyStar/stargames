INSERT INTO public.role_permissions (role, permission)
SELECT r.role, p.permission
FROM (
  SELECT unnest(ARRAY['admin','admin_master','manager','operator','viewer','gerente','supervisor','funcionario','envio','mgmv']::public.app_role[]) AS role
) r
CROSS JOIN (
  SELECT unnest(ARRAY[
    'dashboard.view','clientes.view','clientes.edit','collection.view','collection.edit',
    'mgmv.view','mgmv.edit','mgmv.register_product','import.use','finance.view','settings.view',
    'team.view','team.assign.all','team.assign.team','team.task.update_own','team.task.comment',
    'punch.clock','shipping.mark_sent'
  ]::public.app_permission[]) AS permission
) p
ON CONFLICT (role, permission) DO NOTHING;