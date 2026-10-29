
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Vote } from "lucide-react";

type VoteData = {
  game: {
    id: string;
    name: string;
    status: string;
    roundNumber: number;
  };
  phase: {
    id: string;
    key: string;
    status: string;
  } | null;
  alivePlayers: number;
  totalVotes: number;
  tally: {
    targetPlayerId: string;
    targetName: string;
    votes: number;
  }[];
};

type ApiResult = {
  error?: string;
  message?: string;
  result?: {
    next_phase?: string;
    target_name?: string | null;
    alphabetical_tie_break?: boolean;
  };
};

export default function VillageVoteControl({
  gameId,
}: {
  gameId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<VoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadVotes = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/master/games/${gameId}/village-vote`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Impossible de charger le scrutin.");
      }

      setData(result as VoteData);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erreur de chargement du scrutin."
      );
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVotes();

    const interval = window.setInterval(() => {
      void loadVotes();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadVotes]);

  async function performAction() {
    const isOpening = data?.game.status === "day_discussion";

    const confirmation = isOpening
      ? "Ouvrir le premier scrutin du village ?"
      : data?.game.status === "village_vote_1"
        ? "Clôturer le premier scrutin ? En cas d'égalité, un second tour sera ouvert."
        : "Clôturer le second scrutin ? En cas de nouvelle égalité, l'ordre alphabétique départagera les joueurs.";

    if (!window.confirm(confirmation)) return;

    setProcessing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/village-vote`,
        { method: "POST" }
      );

      const result = (await response.json()) as ApiResult;

      if (!response.ok) {
        throw new Error(result.error ?? "Action impossible.");
      }

      setMessage(result.message ?? "Action effectuée.");

      await loadVotes();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Une erreur est survenue."
      );
    } finally {
      setProcessing(false);
    }
  }

  const status = data?.game.status;
  const canOpen = status === "day_discussion";
  const canClose =
    status === "village_vote_1" || status === "village_vote_2";
  const isSecondBallot = status === "village_vote_2";
  const awaitingDayResolution = status === "day_resolution";

  return (
    <section className="dashboard-panel village-vote-control">
      <p className="section-kicker">GESTION DU SCRUTIN</p>

      <div className="village-vote-control-heading">
        <h2>
          <Vote size={22} />
          Vote du village
        </h2>

        <button
          type="button"
          className="btn btn-secondary village-vote-refresh"
          onClick={() => void loadVotes()}
          disabled={loading || processing}
        >
          <RefreshCw size={15} />
          Actualiser
        </button>
      </div>

      <div className="village-vote-stats">
        <div>
          <span>Joueurs vivants</span>
          <strong>{loading ? "…" : data?.alivePlayers ?? 0}</strong>
        </div>

        <div>
          <span>Votes exprimés</span>
          <strong>{loading ? "…" : data?.totalVotes ?? 0}</strong>
        </div>
      </div>

      <div className="village-vote-tally">
        <h3>
          {isSecondBallot ? "Voix du second tour" : "Voix par joueur"}
        </h3>

        {loading ? (
          <p className="dashboard-muted">Chargement du décompte…</p>
        ) : data?.tally.length ? (
          data.tally.map((item) => (
            <div
              className="village-vote-result"
              key={item.targetPlayerId}
            >
              <span>{item.targetName}</span>
              <strong>
                {item.votes} {item.votes > 1 ? "voix" : "voix"}
              </strong>
            </div>
          ))
        ) : (
          <p className="dashboard-muted">Aucun vote pour le moment.</p>
        )}
      </div>

      {error && (
        <p className="village-vote-error" role="alert">{error}</p>
      )}

      {message && (
        <p className="village-vote-success" role="status">{message}</p>
      )}

      {canOpen && (
        <button
          type="button"
          className="btn btn-primary village-vote-master-action"
          onClick={() => void performAction()}
          disabled={processing || loading}
        >
          {processing ? "Ouverture…" : "Ouvrir le vote du village"}
        </button>
      )}

      {canClose && (
        <button
          type="button"
          className="btn btn-primary village-vote-master-action"
          onClick={() => void performAction()}
          disabled={processing || loading}
        >
          {processing
            ? "Clôture…"
            : isSecondBallot
              ? "Clôturer le second scrutin"
              : "Clôturer le premier scrutin"}
        </button>
      )}

      {awaitingDayResolution && (
        <p className="dashboard-muted">
          Le scrutin est clôturé. La cible est déterminée ; il reste à
          appliquer l&apos;élimination et ses conséquences.
        </p>
      )}
    </section>
  );
}
