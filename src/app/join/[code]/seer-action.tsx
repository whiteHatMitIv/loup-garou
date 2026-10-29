
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, Search, Sparkles } from "lucide-react";

type SeerTarget = {
  id: string;
  displayName: string;
};

type SeerData = {
  targets: SeerTarget[];
};

type SeerResult = {
  inspectedPlayer: {
    displayName: string;
  };
  revealedRole: {
    key: string;
    displayName: string;
    camp: string;
    description: string | null;
  };
  nextPhase: string;
};

type Props = {
  code: string;
  onCompleted: () => void | Promise<void>;
};

export default function SeerAction({ code, onCompleted }: Props) {
  const [data, setData] = useState<SeerData | null>(null);
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState<SeerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadTargets = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/player/seer-action?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );

      const json = await response.json();

      if (!response.ok) {
        throw new Error(
          json.error ?? "Impossible de charger les joueurs."
        );
      }

      const targets = json as SeerData;
      setData(targets);
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

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!targetId || submitting || result) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/player/seer-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          targetPlayerId: targetId,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(
          json.error ?? "Impossible d'effectuer cette inspection."
        );
      }

      setResult(json as SeerResult);
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
      <section className="dashboard-panel seer-action">
        <p>La Voyante consulte les signes de la nuit…</p>
      </section>
    );
  }

  if (result) {
    return (
      <section className="dashboard-panel seer-action">
        <p className="section-kicker">RÉVÉLATION PRIVÉE</p>

        <div className="seer-action-title">
          <Sparkles size={24} />
          <h2>La vision est révélée</h2>
        </div>

        <p className="role-setup-description">
          Tu as inspecté {result.inspectedPlayer.displayName}.
          Voici le rôle découvert.
        </p>

        <div className="seer-reveal">
          <span>Rôle de {result.inspectedPlayer.displayName}</span>
          <strong>{result.revealedRole.displayName}</strong>
          <span className="seer-reveal-camp">
            Camp : {result.revealedRole.camp}
          </span>

          {result.revealedRole.description && (
            <p>{result.revealedRole.description}</p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary seer-action-submit"
          onClick={() => void onCompleted()}
        >
          Continuer
        </button>

        <p className="dashboard-muted">
          Cette information est réservée à toi. Ne la partage pas
          avant la phase de discussion du village.
        </p>
      </section>
    );
  }

  return (
    <section className="dashboard-panel seer-action">
      <p className="section-kicker">PHASE DE NUIT</p>

      <div className="seer-action-title">
        <Eye size={24} />
        <h2>Vision de la Voyante</h2>
      </div>

      <p className="role-setup-description">
        Sélectionne un joueur vivant pour découvrir son rôle.
        Tu ne peux pas t&apos;inspecter toi-même.
      </p>

      {data?.targets.length ? (
        <form onSubmit={submitAction}>
          <label
            className="seer-target-label"
            htmlFor="seer-target"
          >
            Joueur à inspecter
          </label>

          <select
            id="seer-target"
            className="seer-target-select"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            required
          >
            <option value="">Choisir un joueur…</option>

            {data.targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </select>

          {error && (
            <p className="seer-action-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary seer-action-submit"
            disabled={!targetId || submitting}
          >
            <Search size={17} />
            {submitting ? "Inspection en cours…" : "Découvrir son rôle"}
          </button>
        </form>
      ) : (
        <p className="dashboard-muted">
          Aucun autre joueur vivant n&apos;est disponible à inspecter.
        </p>
      )}

      {error && !data?.targets.length && (
        <p className="seer-action-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
