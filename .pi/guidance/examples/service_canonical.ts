// .pi/guidance/examples/service_canonical.ts
//
// Canonical service singleton pattern: interface + factory + typed singleton.
// A real service extends BaseFrontendClass (providing this.debug(),
// auto-logging via create()) and imports dependencies through $services.
//
// ✅ executable: compiles and lints under the scripts project configuration.
// Mirrors what guard_service_conventions S1–S6 enforce.

export type GreetingServiceOptions = {
  readonly prefix: string;
};

export type GreetingServiceInterface = {
  readonly prefix: string;
  greet(name: string): string;
};

class GreetingService implements GreetingServiceInterface {
  readonly prefix: string;

  private constructor(options: GreetingServiceOptions) {
    this.prefix = options.prefix;
  }

  static create(options: GreetingServiceOptions): GreetingServiceInterface {
    return new GreetingService(options);
  }

  greet(name: string): string {
    return `${this.prefix}, ${name}!`;
  }
}

// Typed singleton — export is typed against the interface so the concrete
// class stays swappable/mockable behind the interface (S5).
export const greetingService: GreetingServiceInterface = GreetingService.create({
  prefix: 'Hello',
});
