
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Vote } from "lucide-react";

type VoteTarget = {
  id: string;
  displayName: string;
};

type VoteData = {
  gameStatus: string;
  phaseKey: string;
  currentTargetId: string | null;
  targets: VoteTarget[];
};

type Props = {
  code: string;
  onCompleted: () => void | Promise<void>;
};

export default function VillageVoteAction({ code, onCompleted }: Props) {
  const [data, setData] = useState<VoteData | null>(null);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/player/village-vote?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible de charger le scrutin."
        );
      }

      const voteData = result as VoteData;
      setData(voteData);
      setTargetId(voteData.currentTargetId ?? "");
      setError("");
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

  async function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!targetId || submitting) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/player/village-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          targetPlayerId: targetId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible d'enregistrer le vote."
        );
      }

      setMessage(
        "Vote enregistré. Tu peux encore le modifier tant que le maître n'a pas clôturé le scrutin."
      );

      await loadData();
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
      <section className="dashboard-panel village-vote-action">
        <p>Chargement du scrutin…</p>
      </section>
    );
  }

  return (
    <section className="dashboard-panel village-vote-action">
      <p className="section-kicker">SCRUTIN DU VILLAGE</p>

      <h2 className="village-vote-title">
        <Vote size={22} />
        {data?.phaseKey === "village_vote_2"
          ? "Second tour"
          : "Qui soupçonnes-tu ?"}
      </h2>

      <p className="role-setup-description">
        {data?.phaseKey === "village_vote_2"
          ? "Le premier scrutin était à égalité. Tu dois choisir parmi les joueurs concernés par cette égalité."
          : "Choisis le joueur que tu souhaites voir éliminé. Tu peux modifier ton vote tant que le scrutin reste ouvert."}
      </p>

      {data && data.targets.length > 0 ? (
        <form onSubmit={submitVote}>
          <label className="village-vote-label" htmlFor="village-vote-target">
            Joueur à désigner
          </label>

          <select
            id="village-vote-target"
            className="village-vote-select"
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

          {message && (
            <p className="village-vote-success" role="status">
              <CheckCircle2 size={16} />
              {message}
            </p>
          )}

          {error && (
            <p className="village-vote-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary village-vote-submit"
            disabled={!targetId || submitting}
          >
            {submitting
              ? "Enregistrement…"
              : data.currentTargetId
                ? "Modifier mon vote"
                : "Confirmer mon vote"}
          </button>
        </form>
      ) : (
        <p className="dashboard-muted">
          Aucune cible disponible pour ce scrutin.
        </p>
      )}
    </section>
  );
}
