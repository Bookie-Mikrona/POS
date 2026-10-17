import { Building2, FolderKanban, Users } from "lucide-react";
import type { JournalEntry } from "@workspace/api-client-react";

type Props = Pick<JournalEntry, "costCenterNames" | "projectNames" | "departmentNames">;

export function JournalEntryDimensions({ costCenterNames, projectNames, departmentNames }: Props) {
  const groups = [
    { names: costCenterNames, label: "Stroškovno mesto", Icon: Building2, color: "bg-orange-50 text-orange-700 border-orange-200" },
    { names: projectNames, label: "Projekt", Icon: FolderKanban, color: "bg-blue-50 text-blue-700 border-blue-200" },
    { names: departmentNames, label: "Oddelek", Icon: Users, color: "bg-purple-50 text-purple-700 border-purple-200" },
  ];

  if (!groups.some(group => group.names?.length)) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {groups.map(({ names, label, Icon, color }) => names?.map(name => (
        <span
          key={`${label}:${name}`}
          title={`${label}: ${name}`}
          aria-label={`${label}: ${name}`}
          className={`inline-flex max-w-full items-center gap-1 break-words text-[10px] px-1.5 py-0.5 rounded border ${color}`}
        >
          <Icon aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
          {name}
        </span>
      )))}
    </div>
  );
}
