"use client";

import { FormEvent, useState } from "react";
import { Heart, LoaderCircle, Sparkles } from "lucide-react";

type Target = {
  id: string;
  displayName: string;
};

export default function CupidonAction({
  code,
  targets,
  onCompleted,
}: {
  code: string;
  targets: Target[];
  onCompleted: () => Promise<void>;
}) {
  const [firstPlayerId, setFirstPlayerId] = useState("");
  const [secondPlayerId, setSecondPlayerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (
      !firstPlayerId ||
      !secondPlayerId ||
      firstPlayerId === secondPlayerId
    ) {
      setError("Choisis deux joueurs différents.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/player/cupidon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          firstPlayerId,
          secondPlayerId,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        setError(result.error ?? "Impossible d'enregistrer ce lien.");
        return;
      }

      setSuccess(true);
      await onCompleted();
    } catch {
      setError("Le serveur est inaccessible. Réessaie.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="cupidon-result" role="status">
        <Sparkles size={21} />
        <div>
          <strong>Le lien a été établi.</strong>
          <p>
            Ton action est enregistrée. La partie passe maintenant à la
            première nuit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="cupidon-action-panel">
      <div className="cupidon-action-heading">
        <span className="section-kicker">TON POUVOIR</span>
        <Heart size={20} />
      </div>

      <h3>Choisis les deux amoureux</h3>

      <p>
        Sélectionne deux joueurs. Ils ne sauront pas qu&apos;ils ont été liés.
        Ils conserveront leurs rôles et leurs pouvoirs habituels.
      </p>

      {targets.length < 2 ? (
        <p className="role-validation-message">
          Il faut au moins deux joueurs vivants pour effectuer cette action.
        </p>
      ) : (
        <form className="cupidon-form" onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="cupidon-first">Premier joueur</label>
            <select
              id="cupidon-first"
              value={firstPlayerId}
              onChange={(event) => setFirstPlayerId(event.target.value)}
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

          <div className="form-field">
            <label htmlFor="cupidon-second">Second joueur</label>
            <select
              id="cupidon-second"
              value={secondPlayerId}
              onChange={(event) => setSecondPlayerId(event.target.value)}
              disabled={loading}
              required
            >
              <option value="">Choisir un joueur</option>
              {targets
                .filter((target) => target.id !== firstPlayerId)
                .map((target) => (
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

          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              loading ||
              !firstPlayerId ||
              !secondPlayerId ||
              firstPlayerId === secondPlayerId
            }
          >
            {loading ? (
              <>
                <LoaderCircle className="auth-spinner" />
                Confirmation...
              </>
            ) : (
              <>
                <Heart size={17} />
                Lier les deux joueurs
              </>
            )}
          </button>
        </form>
      )}

      <p className="dashboard-muted">
        Cette décision est définitive. Vérifie les deux noms avant de confirmer.
      </p>
    </section>
  );
}