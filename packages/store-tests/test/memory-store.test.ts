import { MemoryStore } from '@lacijs/core';
import { describeStoreContract } from '../src';

describeStoreContract('MemoryStore', { create: () => new MemoryStore() });
