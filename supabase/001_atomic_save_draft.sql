-- BudgetFlow: brouillon de migration, NE PAS EXECUTER avant tests.
-- Ecriture conditionnelle atomique du document financier existant.
-- La fonction s'execute avec les droits du demandeur (RLS conservee).
create or replace function public.budgetflow_save_if_unchanged(
  expected_data jsonb,
  new_data jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(expected_data) <> 'object'
     or jsonb_typeof(new_data) <> 'object' then
    raise exception 'Invalid BudgetFlow document';
  end if;
  update public.budget_state
     set data = new_data,
         updated_at = now()
   where user_id = auth.uid()
     and data = expected_data;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.budgetflow_save_if_unchanged(jsonb,jsonb)
  from public, anon;
grant execute on function public.budgetflow_save_if_unchanged(jsonb,jsonb)
  to authenticated;

-- Aucun cron et aucune modification des donnees existantes dans ce fichier.
-- IMPORTANT : ce RPC seul ne suffit pas. Les anciens clients continuent
-- d'utiliser un upsert non conditionnel tant qu'ils ne sont pas migres.
