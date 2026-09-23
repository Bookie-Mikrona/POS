import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children: React.ReactNode;
  resetKey?: any;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full p-6 bg-destructive/10 rounded-lg border border-destructive/20 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-serif font-medium text-foreground mb-2">
              Nekaj je šlo narobe
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Prišlo je do nepričakovane napake. Prosimo, poskusite znova.
            </p>
            <Button 
              onClick={() => this.setState({ hasError: false, error: undefined })}
              variant="outline"
            >
              Poskusi znova
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
