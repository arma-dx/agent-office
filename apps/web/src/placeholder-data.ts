// TEMPORARY: sample list so the company switcher shows up until the login task (KALAN-ISLER 0.3).
// Company names are not hard-coded; in 0.3 this file is deleted and the list comes from the API, from the user's memberships.

export interface CompanyOption {
  code: string;
  name: string;
  kind: 'company' | 'private_space' | 'holding';
}

export const PLACEHOLDER_COMPANIES: readonly CompanyOption[] = [
  { code: 'armadx', name: 'Arma DX', kind: 'company' },
  { code: 'pillika', name: 'Pillika', kind: 'company' },
  { code: 'holding', name: 'Holding görünümü', kind: 'holding' },
  { code: 'founder_space', name: 'Kurucu alanı', kind: 'private_space' },
];
