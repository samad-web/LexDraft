import { Card } from '@lexdraft/ui';

interface StubViewProps {
  title: string;
  eyebrow: string;
}

export function StubView({ title, eyebrow }: StubViewProps) {
  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>
        <h1 className="heading-xl">{title}</h1>
      </div>
      <Card>
        <div className="col" style={{ gap: 16, alignItems: 'flex-start' }}>
          <span className="badge badge-cobalt">Coming next</span>
          <p className="body-md muted" style={{ maxWidth: 560 }}>
            This module is wired into the navigation but its UI is being built. The shell, design
            tokens, API contract, and routing are all in place - drop the corresponding view into
            <span className="mono"> src/views/</span> and the route at
            <span className="mono"> /app/{title.toLowerCase()} </span>
            will pick it up automatically.
          </p>
        </div>
      </Card>
    </div>
  );
}
