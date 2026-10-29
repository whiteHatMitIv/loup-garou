
"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle, RefreshCw } from "lucide-react";

type SummaryResponse = {
  error?: string;
  shareText?: string;
};

export default function ShareSummaryButton({
  gameId,
}: {
  gameId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [shareText, setShareText] = useState("");

  async function generateAndCopy() {
    setLoading(true);
    setCopied(false);
    setError("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/summary`,
        { cache: "no-store" }
      );

      const result = (await response.json()) as SummaryResponse;

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible de générer le bilan."
        );
      }

      if (!result.shareText) {
        throw new Error("Le serveur n'a pas retourné de bilan.");
      }

      setShareText(result.shareText);

      try {
        await navigator.clipboard.writeText(result.shareText);
        setCopied(true);
      } catch {
        setError(
          "La copie automatique est bloquée par le navigateur. Sélectionne le texte affiché ci-dessous pour le copier manuellement."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la génération du bilan."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboard-panel share-summary-panel">
      <p className="section-kicker">PARTAGE WHATSAPP</p>

      <h2 className="share-summary-title">
        <MessageCircle size={22} />
        Le bilan de la partie
      </h2>

      <p className="role-setup-description">
        Génère le classement final avec les rôles révélés, les points
        et les éliminations, puis copie le message pour le partager
        dans ton groupe WhatsApp.
      </p>

      <button
        type="button"
        className="btn btn-primary share-summary-button"
        onClick={() => void generateAndCopy()}
        disabled={loading}
      >
        {loading ? (
          <RefreshCw size={17} />
        ) : copied ? (
          <Check size={17} />
        ) : (
          <Copy size={17} />
        )}

        {loading
          ? "Génération du bilan…"
          : copied
            ? "Bilan copié !"
            : "Générer et copier le bilan"}
      </button>

      {copied && (
        <p className="share-summary-success" role="status">
          Le texte est copié. Tu peux maintenant le coller dans WhatsApp.
        </p>
      )}

      {error && (
        <p className="share-summary-error" role="alert">
          {error}
        </p>
      )}

      {shareText && (
        <div className="share-summary-preview">
          <label htmlFor="share-summary-text">
            Aperçu du message
          </label>

          <textarea
            id="share-summary-text"
            value={shareText}
            readOnly
            rows={12}
            onFocus={(event) => event.currentTarget.select()}
          />

          <button
            type="button"
            className="btn btn-secondary share-summary-button"
            onClick={() => void generateAndCopy()}
            disabled={loading}
          >
            <Copy size={16} />
            Réessayer la copie
          </button>
        </div>
      )}
    </section>
  );
}
