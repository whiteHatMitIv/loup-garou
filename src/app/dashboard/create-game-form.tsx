"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clipboard,
  LoaderCircle,
  Plus,
} from "lucide-react";

type CreatedGame = {
  id: string;
  name: string;
  invite_code: string;
  status: string;
  round_number: number;
  created_at: string;
};

export default function CreateGameForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdGame, setCreatedGame] =
    useState<CreatedGame | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setCreatedGame(null);
    setCopied(false);
    setLoading(true);

    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const result = (await response.json()) as {
        game?: CreatedGame;
        error?: string;
      };

      if (!response.ok || !result.game) {
        setError(result.error ?? "Impossible de créer la partie.");
        return;
      }

      setCreatedGame(result.game);
      setName("");
      router.refresh();
    } catch {
      setError(
        "Le serveur est inaccessible. Vérifie ta connexion et réessaie."
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyInviteCode() {
    if (!createdGame) return;

    try {
      await navigator.clipboard.writeText(createdGame.invite_code);
      setCopied(true);
    } catch {
      setError("Impossible de copier le code dans le presse-papiers.");
    }
  }

  async function copyInviteLink() {
    if (!createdGame) return;

    try {
        const inviteUrl = new URL(
            `/join/${createdGame.invite_code}`,
            window.location.origin
        ).toString();

        await navigator.clipboard.writeText(inviteUrl);
        setLinkCopied(true);
        setError("");
        } catch {
            setError("Impossible de copier le lien d'invitation.");
        }
  }

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <div>
          <p className="section-kicker">NOUVELLE PARTIE</p>
          <h2>Préparer une soirée</h2>
        </div>

        <div className="dashboard-icon">
          <Plus size={20} />
        </div>
      </div>

      <form className="create-game-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="game-name">Nom de la partie</label>

          <input
            id="game-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. : La Nuit des Ombres"
            maxLength={80}
            required
          />
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? (
            <>
              <LoaderCircle className="auth-spinner" />
              Création...
            </>
          ) : (
            <>
              <Plus size={18} />
              Créer la partie
            </>
          )}
        </button>
      </form>

      {createdGame && (
        <div className="created-game-notice" role="status">
          <div>
            <Check size={18} />
            <strong>Partie créée avec succès</strong>
          </div>

          <p>{createdGame.name}</p>

          <div className="invite-code-row">
            <span>{createdGame.invite_code}</span>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={copyInviteCode}
            >
              {copied ? <Check size={16} /> : <Clipboard size={16} />}
              {copied ? "Copié" : "Copier le code"}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary invite-link-button"
            onClick={copyInviteLink}
          >
            <Clipboard size={16} />
            {linkCopied ? "Lien copié" : "Copier le lien à partager"}
          </button>

          <p className="dashboard-muted">
            Le code sera utilisable par les joueurs lorsque nous aurons
            développé la page de rejoindre une partie.
          </p>
        </div>
      )}
    </section>
  );
}