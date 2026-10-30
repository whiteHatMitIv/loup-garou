"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Crosshair, LoaderCircle, Target } from "lucide-react";

type HunterTarget = {
  id: string;
  displayName: string;
};

type HunterShotResult = {
  success?: boolean;
  message?: string;
  error?: string;
  result?: {
    game_status?: string;
    winner?: string | null;
    requires_hunter_action?: boolean;
    hunter_target_player_id?: string;
  };
};

type Props = {
  code: string;
  onCompleted: () => void | Promise<void>;
};

export default function HunterAction({ code, onCompleted }: Props) {
  const [targets, setTargets] = useState<HunterTarget[]>([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // ─────────────────────────────────────────────────────────────
  // Après un tir réussi, on rafraîchit automatiquement la partie.
  // On n'utilise AUCUN state intermédiaire ici : `finished` passe
  // une seule fois à `true`, donc l'effet s'exécute exactement une
  // fois, et le timer n'est annulé qu'au démontage du composant.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!finished) return;

    const timer = setTimeout(() => {
      void onCompleted();
    }, 1200);

    return () => clearTimeout(timer);
  }, [finished, onCompleted]);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/player/hunter-action?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Impossible de charger les cibles.");
      }

      setTargets(data.targets ?? []);
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
    void loadTargets();
  }, [loadTargets]);

  async function submitShot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!targetId || submitting || finished) return;

    const target = targets.find((item) => item.id === targetId);

    if (
      !target ||
      !window.confirm(
        `Confirmer ton tir contre ${target.displayName} ? Cette décision est définitive.`
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/player/hunter-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          targetPlayerId: targetId,
        }),
      });

      const data = (await response.json()) as HunterShotResult;

      if (!response.ok) {
        throw new Error(data.error ?? "Impossible d'enregistrer le tir.");
      }

      setFinished(true);
      setMessage(
        data.result?.game_status === "game_over"
          ? "Ton tir a mis fin à la partie. Le bilan s'affiche dans un instant."
          : data.message ?? "Ton action a été enregistrée."
      );
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
      <section className="dashboard-panel hunter-action">
        <p>
          <LoaderCircle className="auth-spinner" size={15} /> Chargement des
          cibles disponibles…
        </p>
      </section>
    );
  }

  if (finished) {
    return (
      <section className="dashboard-panel hunter-action">
        <p className="section-kicker">POUVOIR DU CHASSEUR</p>
        <h2>Ton tir a été résolu</h2>

        <p className="hunter-action-success" role="status">
          {message}
        </p>

        <p className="dashboard-muted">
          <LoaderCircle className="auth-spinner" size={15} /> La suite de la
          partie se charge automatiquement…
        </p>
      </section>
    );
  }

  return (
    <section className="dashboard-panel hunter-action">
      <p className="section-kicker">POUVOIR APRÈS LA MORT</p>

      <h2 className="hunter-action-title">
        <Crosshair size={23} />
        Le Chasseur choisit sa cible
      </h2>

      <p className="role-setup-description">
        Tu peux désigner un joueur vivant. Il sera éliminé, et si cette cible
        est amoureuse d&apos;un autre joueur vivant, son partenaire sera
        également éliminé.
      </p>

      {targets.length === 0 ? (
        <p className="dashboard-muted">
          Aucun joueur vivant n&apos;est disponible comme cible.
        </p>
      ) : (
        <form onSubmit={submitShot}>
          <label className="hunter-target-label" htmlFor="hunter-target">
            <Target size={17} />
            Choisir un joueur
          </label>

          <select
            id="hunter-target"
            className="hunter-target-select"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            required
          >
            <option value="">Sélectionner une cible…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="btn btn-primary hunter-action-submit"
            disabled={!targetId || submitting}
          >
            {submitting ? "Résolution du tir…" : "Confirmer le tir"}
          </button>
        </form>
      )}

      {error && (
        <p className="hunter-action-error" role="alert">
          {error}
        </p>
      )}

      <p className="dashboard-muted">
        Ta cible ne peut pas être sauvée par la potion de vie : cette décision
        intervient après les actions de la Sorcière.
      </p>
    </section>
  );
}