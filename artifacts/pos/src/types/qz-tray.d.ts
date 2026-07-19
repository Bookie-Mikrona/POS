declare module "qz-tray" {
  interface QzConfig {
    printer: string;
  }

  interface QzPrintData {
    type: string;
    format: string;
    data: string;
  }

  const websocket: {
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
    disconnect(): Promise<void>;
    isActive(): boolean;
  };

  const printers: {
    find(query?: string): Promise<string | string[]>;
  };

  const configs: {
    create(printer: string, options?: Record<string, unknown>): QzConfig;
  };

  function print(config: QzConfig, data: QzPrintData[]): Promise<void>;

  const security: {
    setCertificate(cert: null | string | Promise<null | string>): void;
    setSignatureAlgorithm(algo: string): void;
    setSignaturePromise(fn: (toSign: string) => Promise<null>): void;
  };
}
