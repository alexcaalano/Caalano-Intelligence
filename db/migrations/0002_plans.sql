-- Plan rows (SAAS-DESIGN.md sections 6 and 17). Prices are placeholders until
-- the pricing decision in section 12 is final; Stripe ids come in phase 5.
insert into plans (id, name, kind, max_workspaces, max_connections, max_members, refresh_minutes, history_months, features, monthly_aud) values
  ('business',       'Business',        'business', 1,    4,    5,    15, 13, '{pdf,monthly_report,custom_dashboards}', null),
  ('agency_starter', 'Agency Starter',  'agency',   5,    20,   10,   15, 13, '{pdf,monthly_report,custom_dashboards}', null),
  ('agency_growth',  'Agency Growth',   'agency',   15,   60,   25,   10, 25, '{pdf,monthly_report,custom_dashboards,ai_insights}', null),
  ('agency_scale',   'Agency Scale',    'agency',   null, null, null, 5,  37, '{pdf,monthly_report,custom_dashboards,ai_insights,api}', null),
  ('caalano',        'Caalano Digital', 'agency',   null, null, null, 5,  37, '{pdf,monthly_report,custom_dashboards,ai_insights,api,white_label}', 0)
on conflict (id) do nothing;
