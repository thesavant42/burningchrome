import { get, set, del, createStore } from 'idb-keyval';

const store = createStore('burning-chrome-db', 'data-store');

export const storage = {
  async get(key) {
    return get(key, store);
  },
  async set(key, value) {
    return set(key, value, store);
  },
  async remove(key) {
    return del(key, store);
  }
};

