
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, ShieldCheck } from "lucide-react";

type ResolutionResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  result?: {
    requires_hunter_action?: boolean;
    game_status?: string;
    winner?: string | null;
  };
};

export default function NightResolutionControl({
  gameId,
}: {
  gameId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function resolveNight() {
    const confirmed = window.confirm(
      "Résoudre les événements de cette nuit ? Les éliminations seront enregistrées et ne pourront pas être annulées depuis cette action."
    );

    if (!confirmed) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/resolve-night`,
        { method: "POST" }
      );

      const result = (await response.json()) as ResolutionResponse;

      if (!response.ok) {
        throw new Error(result.error ?? "La résolution a échoué.");
      }

      setMessage(
        result.message ?? "La résolution a été effectuée."
      );

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
    <section className="dashboard-panel night-resolution-control">
      <p className="section-kicker">FIN DE LA NUIT</p>

      <h2>
        <Moon size={21} aria-hidden="true" />
        Résolution des événements
      </h2>

      <p className="role-setup-description">
        Enregistre les victimes des Loups et de la Sorcière,
        applique les liens amoureux et vérifie si le Chasseur
        doit utiliser son pouvoir.
      </p>

      <button
        type="button"
        className="btn btn-primary night-resolution-button"
        onClick={() => void resolveNight()}
        disabled={submitting}
      >
        <ShieldCheck size={17} />
        {submitting
          ? "Résolution en cours…"
          : "Résoudre la nuit"}
      </button>

      {message && (
        <p className="night-resolution-success" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="night-resolution-error" role="alert">
          {error}
        </p>
      )}

      <p className="dashboard-muted">
        Si le Chasseur doit agir, la partie passera en phase
        `hunter_action` et attendra son choix avant de continuer.
      </p>
    </section>
  );
}
