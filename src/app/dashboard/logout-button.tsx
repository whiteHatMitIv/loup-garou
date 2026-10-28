"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, LoaderCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError("Impossible de fermer la session.");
      setLoading(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        className="header-action"
        onClick={logout}
        disabled={loading}
      >
        {loading ? (
          <LoaderCircle className="auth-spinner" size={16} />
        ) : (
          <LogOut size={16} />
        )}
        Déconnexion
      </button>

      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}