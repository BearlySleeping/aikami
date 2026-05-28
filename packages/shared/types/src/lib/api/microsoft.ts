import type {
  OAuthTokenAuthorizeRequest,
  OAuthTokenRefreshRequest,
  OAuthTokenResponse,
} from './oauth2.ts';

export type MicrosoftTokenRequest = OAuthTokenAuthorizeRequest;

export type MicrosoftTokenRefreshRequest = OAuthTokenRefreshRequest;

export type MicrosoftTokenResponse = OAuthTokenResponse;

export type MicrosoftSendMailRequest = {
  message: {
    subject: string;
    body: {
      contentType: 'HTML' | 'Text';
      content: string;
    };
    toRecipients: [
      {
        emailAddress: {
          address: string;
        };
      },
    ];
  };
};

export type MicrosoftSendMailResponse = undefined;

export type MicrosoftUser = {
  businessPhones?: string[];
  displayName: string;
  givenName: string;
  jobTitle: string;
  mail: string;
  mobilePhone: string;
  officeLocation: string;
  preferredLanguage: string;
  surname: string;
  userPrincipalName: string; // email
  id: string;
};
