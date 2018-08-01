import { CircuitBreaker } from "../profuse";

import "should";
import "source-map-support/register";

function delay(msec: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, msec));
}

describe("CircuitBreaker", () => {
  it("allows working calls", async () => {
    const breaker = new CircuitBreaker("test", { tripRate: 0.9 });
    breaker.toString().should.eql("CircuitBreaker(test, Normal, successRate=1, concurrent=0)");
    const a = await breaker.do(() => Promise.resolve(3.0));
    const b = await breaker.do(() => Promise.resolve(5.0));
    const n = await breaker.do(() => Promise.resolve(a * b));
    n.should.eql(15);
  });

  it("trips after 50% failures", async () => {
    const breaker = new CircuitBreaker("test", { tripRate: 0.5, window: 5 });

    async function fail(): Promise<void> {
      try {
        await breaker.do(() => {
          return Promise.reject(new Error("boo!"));
        });
        throw new Error("huh?");
      } catch (error) {
        error.message.should.eql("boo!");
      }
    }

    async function succeed(): Promise<void> {
      await breaker.do(() => Promise.resolve(3.0));
    }

    await fail();
    breaker.successRate.should.eql(0.8);
    await succeed();
    breaker.successRate.should.eql(0.8);
    await fail();
    breaker.successRate.should.eql(0.6);
    await succeed();
    breaker.successRate.should.eql(0.6);
    await fail();
    breaker.successRate.should.eql(0.4);
    try {
      await succeed();
      throw new Error("huh?");
    } catch (error) {
      error.message.should.match(/tripped/);
    }

    breaker.clear();

    await fail();
    breaker.successRate.should.eql(0.8);
    await fail();
    breaker.successRate.should.eql(0.6);
    await fail();
    breaker.successRate.should.eql(0.4);
    try {
      await succeed();
      throw new Error("huh?");
    } catch (error) {
      error.message.should.match(/tripped/);
    }
  });

  it("trips with too many concurrent requests", async () => {
    const breaker = new CircuitBreaker("test", { maxConcurrent: 3 });
    await Promise.all([
      breaker.do(() => delay(50)),
      breaker.do(() => delay(50)),
      breaker.do(() => delay(50)),
      breaker.do(() => delay(50))
    ]).should.be.rejectedWith(/tripped/);
  });

  it("allows a probation request after time has passed", async () => {
    const breaker = new CircuitBreaker("test", { checkInterval: 50 });
    breaker.trip();
    await breaker.do(() => Promise.resolve(3.0)).should.be.rejectedWith(/tripped/);
    await delay(50);

    breaker.check();
    breaker.toString().should.match(/Probation/);
    const a = await breaker.do(() => Promise.resolve(4.0));
    a.should.eql(4);
    breaker.toString().should.match(/Normal/);
  });

  it("drops back to tripped if an error happens in probation", async () => {
    const breaker = new CircuitBreaker("test", { checkInterval: 50 });
    breaker.trip();
    await delay(50);
    await breaker.do(() => {
      throw new Error("oh noes");
    }).should.be.rejectedWith(/oh noes/);
    await breaker.do(() => Promise.resolve(10)).should.be.rejectedWith(/tripped/);
  });
});
