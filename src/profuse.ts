const DEFAULT_CHECK_INTERVAL = 30000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = Math.pow(10, 6);
const DEFAULT_TRIP_RATE = 0.9;
const DEFAULT_WINDOW = 100;

type Callback<T> = (error?: Error, result?: T) => void;

export enum Mode {
  Normal,
  Tripped,
  Probation
}

export interface CircuitBreakerOptions {
  // maximum concurrent requests before deciding the service is wedged
  maxConcurrent?: number;

  // required success rate to keep the circuit breaker happy
  tripRate?: number;

  // number of requests to remember success/failure for when computing success rate
  window?: number;

  // how often to test the service once the circuit breaker has been tripped
  checkInterval?: number;

  // if you'd like to log when the circuit breaker trips and clears:
  logger?: (message: string) => void;
}

export class CircuitBreaker {
  mode: Mode = Mode.Normal;
  checkInterval = DEFAULT_CHECK_INTERVAL;
  lastCheck = 0;

  // track concurrent requests around the promise:
  concurrent = 0;
  maxConcurrent = DEFAULT_MAX_CONCURRENT_REQUESTS;

  // track the success rate by counting how many successes (positive #) or
  // failures (negative) happen during a sliding window. each flip from a
  // success to failure adds a new element to the history array, and old ones
  // eventually drop off.
  history: number[] = [];
  window = DEFAULT_WINDOW;
  tripRate = DEFAULT_TRIP_RATE;

  logger?: (message: string) => void;

  constructor(public name: string, options: CircuitBreakerOptions = {}) {
    if (options.maxConcurrent !== undefined) this.maxConcurrent = options.maxConcurrent;
    if (options.tripRate !== undefined) this.tripRate = options.tripRate;
    if (options.window !== undefined) this.window = options.window;
    if (options.checkInterval !== undefined) this.checkInterval = options.checkInterval;
    if (options.logger !== undefined) this.logger = options.logger;
    this.clear();
  }

  toString(): string {
    return `CircuitBreaker(${this.name}, ${Mode[this.mode]}, successRate=${this.successRate}, concurrent=${this.concurrent})`;
  }

  clear() {
    // start off with a perfect history.
    this.history = [ this.window ];
    this.mode = Mode.Normal;
  }

  get successRate() {
    let score = 0, count = 0;
    for (let i = 0; i < this.history.length && count <= this.window; i++) {
      if (this.history[i] < 0) {
        count += -this.history[i];
      } else {
        count += this.history[i];
        score += this.history[i];
      }
    }
    return score / count;
  }

  trip() {
    this.mode = Mode.Tripped;
    this.lastCheck = Date.now();
    if (this.logger) this.logger(`Tripping circuit breaker: ${this.toString()}`);
  }

  private addResult(result: number) {
    const last = this.history[this.history.length - 1];
    if ((last > 0 && result < 0) || (last < 0 && result > 0)) {
      this.history.push(result);
    } else {
      this.history[this.history.length - 1] += result;
    }

    // drop the oldest count.
    if (this.history[0] < 0) {
      this.history[0]++;
    } else {
      this.history[0]--;
    }
    if (this.history[0] == 0) this.history.shift();

    if (result > 0 && this.mode == Mode.Probation) {
      if (this.logger) this.logger(`Resetting to normal: ${this.toString()}`);
      this.mode = Mode.Normal;
    } else if (result < 0) {
      if (this.mode == Mode.Probation || this.successRate < this.tripRate) {
        this.trip();
      }
    }
  }

  private addConcurrent() {
    this.concurrent++;
    if (this.concurrent > this.maxConcurrent) {
      this.trip();
    }
  }

  private finishedConcurrent() {
    this.concurrent--;
  }

  // okay to try?
  check(): boolean {
    if (this.mode == Mode.Tripped) {
      if (this.lastCheck + this.checkInterval <= Date.now()) {
        this.mode = Mode.Probation;
        return true;
      } else {
        return false;
      }
    }
    return true;
  }

  // always returns a Promise.
  async do<T>(f: () => Promise<T>): Promise<T> {
    this.addConcurrent();
    if (!this.check()) {
      this.finishedConcurrent();
      throw new Error(`Circuit breaker tripped: ${this.name}`);
    }

    try {
      const rv = await f();
      this.addResult(1);
      this.finishedConcurrent();
      return rv;
    } catch (error) {
      this.addResult(-1);
      this.finishedConcurrent();
      throw error;
    }
  }

  // callback version
  doCallback<T>(f: (callback: Callback<T>) => void, callback: Callback<T>) {
    this.addConcurrent();
    if (!this.check()) {
      this.finishedConcurrent();
      callback(new Error(`Circuit breaker tripped: ${this.name}`));
      return;
    }

    f((error, value) => {
      if (error) {
        this.addResult(-1);
        this.finishedConcurrent();
        callback(error);
      } else {
        this.addResult(1);
        this.finishedConcurrent();
        callback(undefined, value);
      }
    });
  }
}
