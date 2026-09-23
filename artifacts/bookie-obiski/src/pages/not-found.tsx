import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl font-serif text-foreground mb-4">404</h1>
        <p className="text-muted-foreground mb-8">Te strani žal ne najdemo.</p>
        <Link href="/" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Nazaj na prvo stran
        </Link>
      </div>
    </div>
  );
}
