import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Star, Loader2 } from 'lucide-react';
import { QrGostNarociloResponse } from '@workspace/api-client-react';
import { useGetQrOrderCompletion, useCreateQrOrderFeedback, getGetQrOrderCompletionQueryKey } from '@workspace/api-client-react';
import { Textarea } from '@/components/ui/textarea';

type SuccessViewProps = {
  response: QrGostNarociloResponse;
  token: string;
  qrNapravaId: string;
  activated: boolean;
  onReset: () => void;
};

function formatirajPredvidenPrevzem(predvidenPrevzem: string) {
  const date = new Date(predvidenPrevzem);
  if (Number.isNaN(date.getTime())) return predvidenPrevzem;

  return new Intl.DateTimeFormat("sl-SI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Ljubljana",
  }).format(date);
}

function StarRating({ label, value, onChange, disabled }: { label: string, value: number, onChange: (val: number) => void, disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 items-center">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => onChange(star)}
            className={`p-1 transition-colors ${disabled ? 'cursor-not-allowed' : 'hover:scale-110 active:scale-95'}`}
            data-testid={`star-${label.toLowerCase()}-${star}`}
          >
            <Star className={`w-8 h-8 ${value >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function SuccessView({ response, token, qrNapravaId, activated, onReset }: SuccessViewProps) {
  const completionQuery = useGetQrOrderCompletion(
    token,
    response.narociloId,
    { qrNapravaId },
    {
      query: {
        enabled: !!token && !!qrNapravaId && !!response.narociloId && activated,
        queryKey: getGetQrOrderCompletionQueryKey(token, response.narociloId, { qrNapravaId }),
        refetchInterval: (query) => {
          if (query.state.data?.completed) return false;
          return 5000; // Poll every 5s until completed
        },
      },
      request: { credentials: 'include' }
    }
  );

  const feedbackMutation = useCreateQrOrderFeedback({
    request: { credentials: 'include' }
  });

  const [foodScore, setFoodScore] = useState(0);
  const [ambienceScore, setAmbienceScore] = useState(0);
  const [serviceScore, setServiceScore] = useState(0);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const showFeedback = completionQuery.data?.completed && completionQuery.data?.feedbackEligible;
  const canSubmit = foodScore > 0 && ambienceScore > 0 && serviceScore > 0 && consent;

  const handleSubmitFeedback = () => {
    if (!canSubmit) return;
    feedbackMutation.mutate({
      token,
      narociloId: response.narociloId,
      data: {
        qrNapravaId,
        foodScore,
        ambienceScore,
        serviceScore,
        comment: comment.trim() || undefined,
        consentVersion: "v1" // Minimal explicit consent requirement
      }
    }, {
      onSuccess: () => {
        setSubmitted(true);
      }
    });
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background" data-testid="success-view">
      <div className="flex-1 flex flex-col items-center p-6 text-center max-w-md mx-auto w-full pt-12 space-y-8">

        <div className="w-24 h-24 bg-primary/5 rounded-full flex items-center justify-center mb-2">
          <CheckCircle2 className="w-12 h-12 text-primary" />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-display font-semibold">Hvala!</h1>
          <p className="text-muted-foreground text-lg">
            Vaše naročilo je sprejeto in ga že pripravljamo.
          </p>
        </div>

        {response.predvidenPrevzem && (
          <div className="w-full bg-secondary/50 rounded-2xl p-5 border flex flex-col items-center justify-center space-y-2">
            <Clock className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Pripravljeno ob</span>
            <span className="text-2xl font-bold font-display" data-testid="text-prep-time">
              {formatirajPredvidenPrevzem(response.predvidenPrevzem)}
            </span>
          </div>
        )}

        {/* Feedback Section */}
        {showFeedback && !submitted && (
          <div className="w-full bg-card border rounded-3xl p-6 space-y-6 shadow-sm animate-in fade-in slide-in-from-bottom-4" data-testid="feedback-section">
            <div className="space-y-2">
              <h2 className="text-xl font-display font-semibold">Kako ste zadovoljni?</h2>
              <p className="text-sm text-muted-foreground">Vaše mnenje nam pomaga izboljšati izkušnjo.</p>
            </div>

            {feedbackMutation.isError && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl border border-destructive/20" data-testid="feedback-error">
                Prišlo je do napake ali pa ste mnenje za to naročilo že oddali.
              </div>
            )}

            <div className="space-y-5">
              <StarRating label="Hrana in pijača" value={foodScore} onChange={setFoodScore} disabled={feedbackMutation.isPending} />
              <StarRating label="Ambient" value={ambienceScore} onChange={setAmbienceScore} disabled={feedbackMutation.isPending} />
              <StarRating label="Postrežba" value={serviceScore} onChange={setServiceScore} disabled={feedbackMutation.isPending} />

              <div className="space-y-2 text-left pt-2">
                <label className="text-sm font-medium px-1">Komentar (neobvezno)</label>
                <Textarea
                  placeholder="Kaj vam je bilo še posebej všeč in kaj lahko izboljšamo?"
                  className="resize-none h-24 rounded-xl"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={feedbackMutation.isPending}
                  data-testid="input-feedback-comment"
                />
              </div>

              <div className="flex items-start gap-3 pt-2 text-left">
                <div className="pt-1">
                  <input
                    type="checkbox"
                    id="consent"
                    className="w-4 h-4 rounded border-border"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={feedbackMutation.isPending}
                    data-testid="checkbox-feedback-consent"
                  />
                </div>
                <label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  Strinjam se, da lahko lokal anonimno obdela to oceno za namene izboljšanja storitev. Ne zbiramo nobenih osebnih podatkov.
                </label>
              </div>
            </div>

            <Button
              className="w-full h-12 rounded-xl text-base"
              disabled={!canSubmit || feedbackMutation.isPending}
              onClick={handleSubmitFeedback}
              data-testid="button-submit-feedback"
            >
              {feedbackMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              Oddaj oceno
            </Button>
          </div>
        )}

        {submitted && (
          <div className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 rounded-3xl p-6 space-y-2 animate-in zoom-in-95 duration-300" data-testid="feedback-success">
            <div className="flex justify-center mb-3">
              <Star className="w-10 h-10 fill-emerald-500 text-emerald-500" />
            </div>
            <h2 className="text-xl font-display font-semibold text-emerald-900">Mnenje prejeto!</h2>
            <p className="text-sm">Hvala, da ste si vzeli čas in delili vaše mnenje z nami.</p>
          </div>
        )}

      </div>

      <div className="p-6 pb-12 mt-auto shrink-0 w-full max-w-md mx-auto">
        <Button
          className="w-full h-14 text-lg font-medium rounded-xl"
          onClick={onReset}
          data-testid="button-new-order"
        >
          Sestavi novo naročilo
        </Button>
      </div>
    </div>
  );
}
