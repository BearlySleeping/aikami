/**
 * Ambient type declarations for optional npm packages.
 */

declare module '@google-cloud/secret-manager' {
  export class SecretManagerServiceClient {
    accessSecretVersion(req: {
      name: string;
    }): Promise<[{ payload?: { data?: { toString(): string } } }]>;
  }
}
