
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel, Moon, ShieldCheck } from "lucide-react";

type ApiResponse = {
  error?: string;
  message?: string;
  result?: {
    requires_hunter_action?: boolean;
    game_status?: string;
    winner?: string | null;
  };
};

export default function DayResolutionControl({
  gameId,
  target
}: {
  gameId: string;
  target: { id: string; displayName: string } | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function resolveVote() {
    const targetLabel = target
      ? `La cible du scrutin est ${target.displayName}.`
      : "Aucune cible n'a été sélectionnée.";
    
    const confirmed = window.confirm(
      `Êtes-vous sûr de vouloir résoudre le scrutin du village ?\n\n${targetLabel}\n\nCette action est irréversible.`
    )

    if (!confirmed) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/resolve-day`,
        { method: "POST" }
      );

      const result = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(result.error ?? "La résolution a échoué.");
      }

      setMessage(result.message ?? "Résolution terminée.");

      // Rafraîchir le statut affiché et les composants serveur.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="dashboard-panel day-resolution-control">
      <p className="section-kicker">RÉSULTAT DU SCRUTIN</p>

      <h2 className="day-resolution-title">
        <Gavel size={22} />
        Appliquer l&apos;élimination
      </h2>

      <p className="role-setup-description">
        Enregistre le décès de la cible, élimine son amoureux le cas échéant,
        puis donne au Chasseur l&apos;occasion d&apos;agir si son pouvoir est déclenché.
        Les conditions de victoire seront vérifiées ensuite.
      </p>

      {target && (
        <div className="witch-victim">
          <span>Cible du scrutin</span>
          <strong>{target.displayName}</strong>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary day-resolution-submit"
        onClick={() => void resolveVote()}
        disabled={submitting}
      >
        <ShieldCheck size={17} />
        {submitting ? "Résolution en cours…" : "Résoudre le vote du village"}
      </button>

      {message && (
        <p className="day-resolution-success" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="day-resolution-error" role="alert">
          {error}
        </p>
      )}

      <p className="dashboard-muted day-resolution-note">
        <Moon size={15} />
        Après la résolution, la partie s&apos;arrêtera si une équipe a gagné,
        sinon la prochaine nuit commencera.
      </p>
    </section>
  );
}
