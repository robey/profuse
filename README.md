# profuse

Profuse is an implementation of the "circuit breaker" pattern, using promises instead of callbacks. It's written in typescript so you can use type-safe checks if you want to (but you don't have to).

A "circuit breaker" wraps a remote call (for example, to a database or a REST service), watching for exceptions. If too many exceptions happen, the breaker trips.

Once tripped, all calls will fail immediately. After a while, the breaker will move into probation mode, where a single success will reset it back to normal mode, or a single failure will cause it to trip again. This allows failing remote services to "fail fast" and stops your client from pummeling them while they're down.

## Usage

```es6
const breaker = new CircuitBreaker("database", { tripRate: 0.95 });
breaker.do(() => {
  return db.getUser(userId);
}).then(user => ... );
```

The options are documented in `profuse.ts`.

There is also a callback version, if you aren't comfortable with promises yet, or are targeting older platforms. The syntax is a bit more confusing because of the inside-out nature of callbacks: It accepts a function that takes a callback, and _your_ callback.

```es6
const breaker = new CircuitBreaker("database", { tripRate: 0.95 });
breaker.doCallback(cb => fs.open(path, flags, cb), (error, file) => {
  // do things with file
});
```

If you prefer, you can use the lower-level API:

```es6
const breaker = new CircuitBreaker("database", { tripRate: 0.95 });
breaker.tryStart();  // throws an exception if the circuit breaker has tripped
fs.open(path, flags, (error, file) => {
  breaker.registerResult(error == null);
  // do things with file
});
```

## Logic

In normal mode, trip if:
  - less than X percent (`tripRate`) of the last N requests (`window`) succeeded
  - too many (`maxConcurrent`) concurrent requests (may indicate a too-long or missing timeout)

In tripped mode, go into probation if:
  - time has passed (`checkInterval`)

In probation mode:
  - any successful request: go back to normal mode
  - any failed request: go back to tripped mode

## Build

```sh
$ npm i
$ npm test
```

## License

Apache 2 (open-source) license, included in `LICENSE.txt`.

## Authors

@robey - Robey Pointer <robeypointer@gmail.com>
