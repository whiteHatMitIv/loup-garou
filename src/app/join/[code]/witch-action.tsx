
"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Heart, Skull } from "lucide-react";

type WitchData = {
  wolfVictim: {
    id: string;
    displayName: string;
  } | null;
  lifePotionAvailable: boolean;
  deathPotionAvailable: boolean;
  eligibleTargets: {
    id: string;
    displayName: string;
  }[];
};

type Props = {
  code: string;
  onCompleted: () => void | Promise<void>;
};

export default function WitchAction({ code, onCompleted }: Props) {
  const [data, setData] = useState<WitchData | null>(null);
  const [saveLife, setSaveLife] = useState(false);
  const [poisonTargetPlayerId, setPoisonTargetPlayerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/player/witch-action?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible de charger les actions."
        );
      }

      setData(result as WitchData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue."
      );
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  async function submitAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!data || submitting) return;

    if (saveLife && !data.wolfVictim) {
      setError("Aucune victime des Loups ne peut être sauvée.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/player/witch-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          saveLife,
          poisonTargetPlayerId: poisonTargetPlayerId || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible d'enregistrer les choix."
        );
      }

      setSuccess("Tes actions ont été enregistrées.");
      await onCompleted();
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

  if (loading) {
    return (
      <section className="dashboard-panel witch-action">
        <p>Chargement des potions et de la victime des Loups…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="dashboard-panel witch-action">
        <h2>Action de la Sorcière</h2>
        <p className="witch-action-error" role="alert">
          {error || "Les informations de la phase sont indisponibles."}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void loadData()}
        >
          Réessayer
        </button>
      </section>
    );
  }

  return (
    <section className="dashboard-panel witch-action">
      <p className="section-kicker">PHASE DE NUIT</p>

      <div className="witch-action-title">
        <FlaskConical size={23} />
        <h2>Actions de la Sorcière</h2>
      </div>

      <p className="role-setup-description">
        Tu peux utiliser chacune de tes potions une seule fois
        pendant la partie. Tu peux aussi conserver les deux.
      </p>

      <div className="witch-victim">
        <span>Victime choisie par les Loups</span>
        <strong>
          {data.wolfVictim
            ? data.wolfVictim.displayName
            : "Aucune victime (aucun vote décisif)"}
        </strong>
      </div>

      <form onSubmit={submitAction}>
        <label className="witch-potion-option">
          <input
            type="checkbox"
            checked={saveLife}
            onChange={(event) => setSaveLife(event.target.checked)}
            disabled={!data.lifePotionAvailable || !data.wolfVictim}
          />

          <span className="witch-potion-icon">
            <Heart size={20} />
          </span>

          <span className="witch-potion-copy">
            <strong>Potion de vie</strong>
            <small>
              {data.lifePotionAvailable
                ? data.wolfVictim
                  ? `Sauver ${data.wolfVictim.displayName}`
                  : "Indisponible sans victime des Loups"
                : "Potion déjà utilisée"}
            </small>
          </span>
        </label>

        <div className="witch-poison-field">
          <label htmlFor="witch-poison-target">
            <span className="witch-potion-icon">
              <Skull size={20} />
            </span>
            <span>
              <strong>Potion de mort</strong>
              <small>
                {data.deathPotionAvailable
                  ? "Choisis une cible ou conserve la potion."
                  : "Potion déjà utilisée"}
              </small>
            </span>
          </label>

          <select
            id="witch-poison-target"
            value={poisonTargetPlayerId}
            onChange={(event) =>
              setPoisonTargetPlayerId(event.target.value)
            }
            disabled={!data.deathPotionAvailable}
          >
            <option value="">Ne pas utiliser la potion</option>
            {data.eligibleTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="witch-action-error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="witch-action-success" role="status">
            {success}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary witch-action-submit"
          disabled={submitting}
        >
          {submitting
            ? "Enregistrement…"
            : "Confirmer mes actions"}
        </button>

        <p className="dashboard-muted witch-action-warning">
          Attention : après confirmation, la phase passe à la suivante.
          Vérifie tes choix avant d&apos;envoyer. Tu peux utiliser les deux
          potions pendant la même nuit si elles sont encore disponibles.
        </p>
      </form>
    </section>
  );
}
