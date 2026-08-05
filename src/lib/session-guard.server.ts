export async function hasAnyInternalRole(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
