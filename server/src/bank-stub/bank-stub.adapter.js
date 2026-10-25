export class BankStubAdapter {
  async connect(_credentials) {
    return { connected: true, provider: 'stub' };
  }

  async sync() {
    return { synced: true, transactions: 0 };
  }

  async accounts() {
    return [];
  }
}

export const bankAdapter = new BankStubAdapter();