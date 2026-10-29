"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Moon,
  Swords,
} from "lucide-react";

type Target = {
  id: string;
  displayName: string;
};

export default function WolfVoteAction({
  code,
  targets,
  currentTargetId,
  onCompleted,
}: {
  code: string;
  targets: Target[];
  currentTargetId: string | null;
  onCompleted: () => Promise<void>;
}) {
  const [selectedTarget, setSelectedTarget] = useState(
    currentTargetId ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTarget(currentTargetId ?? "");
  }, [currentTargetId]);

  async function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!selectedTarget) {
      setError("Choisis une cible avant de confirmer.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/player/wolf-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          targetPlayerId: selectedTarget,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        setError(result.error ?? "Impossible d'enregistrer ton vote.");
        return;
      }

      setMessage("Ton choix a été enregistré secrètement.");
      await onCompleted();
    } catch {
      setError("Le serveur est inaccessible. Réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="wolf-vote-panel">
      <div className="wolf-vote-heading">
        <span className="section-kicker">ACTION NOCTURNE</span>
        <Moon size={20} />
      </div>

      <h3>Choisissez votre victime</h3>

      <p>
        Vote pour un joueur vivant du village. Les choix des autres Loups
        restent secrets pendant le scrutin. La cible finale sera celle
        qui aura obtenu le plus de voix.
      </p>

      {targets.length === 0 ? (
        <p className="role-validation-message">
          Aucune cible n&apos;est actuellement disponible.
        </p>
      ) : (
        <form className="wolf-vote-form" onSubmit={submitVote}>
          <div className="form-field">
            <label htmlFor="wolf-target">Cible du vote</label>

            <select
              id="wolf-target"
              value={selectedTarget}
              onChange={(event) => setSelectedTarget(event.target.value)}
              disabled={loading}
              required
            >
              <option value="">Choisir un joueur</option>

              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.displayName}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {message && (
            <p className="wolf-vote-success" role="status">
              <CheckCircle2 size={17} />
              {message}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !selectedTarget}
          >
            {loading ? (
              <>
                <LoaderCircle className="auth-spinner" />
                Enregistrement...
              </>
            ) : (
              <>
                <Swords size={17} />
                {currentTargetId ? "Modifier mon choix" : "Confirmer mon choix"}
              </>
            )}
          </button>
        </form>
      )}

      <p className="dashboard-muted">
        Tu peux modifier ton choix tant que le maître du jeu n&apos;a pas
        clôturé le vote.
      </p>
    </section>
  );
}