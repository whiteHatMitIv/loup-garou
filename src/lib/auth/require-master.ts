import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function getMasterUser(): Promise<User | null> {
  const masterUserId = process.env.MASTER_USER_ID;

  if (!masterUserId) {
    throw new Error(
      "La variable MASTER_USER_ID doit être configurée."
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  if (data.user.id !== masterUserId) {
    return null;
  }

  return data.user;
}