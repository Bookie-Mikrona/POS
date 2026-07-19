import { AlertTriangle } from "lucide-react";

interface Props {
  razlika: number;
}

export function DdvNeskladjeAlert({ razlika }: Props) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-300 px-3 py-2 text-yellow-800 text-xs" data-testid="ddv-neskladje-alert">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-500" />
      <span>
        DDV neskladje ({razlika.toFixed(2)} EUR) — izdaja računa bo morda zavrnjena.
      </span>
    </div>
  );
}
