declare namespace Chai {
  export type Assertion = {
    toAllow(): void;
    toDeny(): void;
  };
}
