import { strict as assert } from 'assert';
import { main } from '../src';

if (process.argv[2] === 'serve') {
  void (async () => {
    const app = await main(true);
    assert.ok(typeof app === 'function');
    assert.equal(typeof app.use, 'function');

    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string' || !process.send) {
        throw new Error('Unable to report test server address');
      }
      process.send(address.port);
    });
  })();
}
