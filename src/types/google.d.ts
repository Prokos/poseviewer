interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: '' | 'consent' }) => void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient: (options: {
      client_id: string;
      scope: string;
      callback: (response: TokenResponse) => void;
    }) => TokenClient;
  };
}

interface GoogleNamespace {
  accounts: GoogleAccounts;
}

interface Window {
  google?: GoogleNamespace;
}
