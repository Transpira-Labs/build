// Starter templates: complete, runnable environments a user can copy and build
// off of. Each `build()` returns a fresh ProjectDoc with brand-new ids, so
// using a template twice produces two independent environments.
//
// Every template projects to a valid IR (../ir/schema): a described environment,
// at least one task with a prompt and a good/bad rubric, and a train config —
// i.e. something the backend could actually compile and train.

import { nanoid } from "nanoid";
import { defaultTrain, type Block, type BlockKind, type ProjectDoc } from "@/lib/blocks/model";

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function block(kind: BlockKind, props: Partial<Block> = {}, children: Block[] = []): Block {
  return { id: nanoid(8), kind, children, ...props };
}

const text = (kind: BlockKind, value: string) => block(kind, { text: value });

function environment(overview: string, setup: string): Block {
  return block("environment", {}, [text("overview", overview), text("setup", setup)]);
}

function tool(name: string, goal: string, input: string, output: string): Block {
  return block("tool", { name }, [
    text("goal", goal),
    text("input", input),
    text("output", output),
  ]);
}

function task(opts: {
  name: string;
  prompt: string;
  /** Answer-format guidance, appended to the prompt (tasks have no format block). */
  format?: string;
  good: string[];
  bad: string[];
}): Block {
  const scoring = block("scoring", {}, [
    ...opts.good.map((t) => text("good_outcome", t)),
    ...opts.bad.map((t) => text("bad_outcome", t)),
  ]);
  const prompt = opts.format ? `${opts.prompt}\n\n${opts.format}` : opts.prompt;
  return block("task", { name: opts.name }, [text("prompt", prompt), scoring]);
}

/** The single Taskset main block that holds every task (tasks are groups now). */
function taskset(tasks: Block[]): Block {
  return block("taskset", {}, tasks);
}

/** Training is doc-level state (not a block); `doc()` lifts this into doc.train. */
function train(model: string, setSize: number, improvement: string): Block {
  return block("train", {}, [
    text("model", model),
    block("set_size", { num: setSize }),
    text("improvement", improvement),
  ]);
}

/** Place main blocks on the canvas in a tidy 3-column grid so none overlap. */
function layout(mains: Block[]): Block[] {
  const COLS = 3;
  const COLW = 360;
  const ROWH = 470;
  return mains.map((b, i) => ({
    ...b,
    x: 32 + (i % COLS) * COLW,
    y: 32 + Math.floor(i / COLS) * ROWH,
  }));
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export interface Template {
  /** Stable identity for the card list. */
  key: string;
  title: string;
  /** One-line description shown on the card. */
  blurb: string;
  /** Short category label. */
  tag: string;
  /** Accent dot colour (mirrors the block palette). */
  color: string;
  /** Fresh, independent ProjectDoc each call. */
  build: () => ProjectDoc;
}

function doc(name: string, mains: Block[]): ProjectDoc {
  // Tasks are groups, not canvas mains — collect any listed inline into the one
  // Taskset (placed where the first task appears), so the doc matches the
  // current schema and needs no load-time migration.
  const tasks = mains.filter((b) => b.kind === "task");
  const trainBlock = mains.find((b) => b.kind === "train");
  const blocks: Block[] = [];
  let placed = false;
  for (const b of mains) {
    if (b.kind === "task") {
      if (!placed) {
        blocks.push(taskset(tasks));
        placed = true;
      }
      continue;
    }
    if (b.kind === "train") continue; // lifted into doc.train below
    blocks.push(b);
  }

  // Training is doc-level state, not a canvas block.
  const fb = defaultTrain();
  const train = trainBlock
    ? {
        model: trainBlock.children.find((c) => c.kind === "model")?.text?.trim() || fb.model,
        setSize: trainBlock.children.find((c) => c.kind === "set_size")?.num ?? fb.setSize,
        improvement:
          trainBlock.children.find((c) => c.kind === "improvement")?.text?.trim() ||
          fb.improvement,
      }
    : fb;

  return { id: nanoid(10), name, version: 1, blocks: layout(blocks), train };
}

export const TEMPLATES: Template[] = [
  {
    // Reversed from SupChain-Bench (../sc-bench), a HUD tool-use benchmark for
    // supply-chain order management. The three-tier order database and 8-tool
    // conditional call flow are recreated here as a platform environment.
    key: "supchain-bench",
    title: "SupChain-Bench",
    blurb:
      "Answer supply-chain order questions by chaining calls across a three-tier order database.",
    tag: "Tool use",
    color: "#3F7A74",
    build: () =>
      doc("SupChain-Bench", [
        environment(
          "A supply-chain order-management environment: answer natural-language questions about orders by making strategic tool calls across a three-tier system (Trade → Fulfillment → Warehouse).",
          "The data is a simulated order database with five tables (trade orders, fulfillment orders, warehouse orders, error logs, cancellation context). Each trade order has 1–5 fulfillment orders, and each fulfillment has 1–3 warehouse orders. Answering requires chaining multiple tool calls with conditional logic: start from the trade order, branch on each fulfillment's status (cancelled → cancellation tools, error → error tools), then drill into each warehouse order. The final answer is a structured summary of the orders, statuses, reasons, and error details.",
        ),
        tool(
          "query_buyer_and_related",
          "Entry point: given a trade order id, return the buyer and every related fulfillment and warehouse order id.",
          "A trade order id, e.g. 'T1030'.",
          "buyer_id plus a related_item list of { fulfillment_id, warehouse_order_id } pairs (empty if the order id is unknown).",
        ),
        tool(
          "get_fulfillment_status",
          "Get the aggregated business status of a fulfillment order, rolled up from its warehouse orders.",
          "A fulfillment order id, e.g. 'FO2080'.",
          "status: one of cancelled, error, in_transit, dispatched, delivered, packing_done, or packing_in_progress.",
        ),
        tool(
          "get_cancel_scenes",
          "For a cancelled fulfillment order, find who initiated the cancellation.",
          "A fulfillment order id.",
          "cancelType: BUYER or SELLER (null if the order was not cancelled).",
        ),
        tool(
          "get_cancel_error_code",
          "Get the cancellation reason code and message for a cancelled fulfillment order.",
          "A fulfillment order id.",
          "cancelErrorCode and cancelErrorMsg (the stated reason text); null/null if none.",
        ),
        tool(
          "get_error_reason",
          "Get fulfillment-level error details when a fulfillment order's status is 'error'.",
          "A fulfillment order id.",
          "code and text describing the error (null/null if there is no error).",
        ),
        tool(
          "check_fake_shipping",
          "Check whether a fulfillment order is flagged for fake shipping.",
          "A fulfillment order id.",
          "exceptionFlag: true if a fake-shipping flag is present, otherwise false.",
        ),
        tool(
          "get_warehouse_status",
          "Get the status and error code of a specific warehouse order under a fulfillment order.",
          "A fulfillment order id and a warehouse order id.",
          "status (mapped warehouse status) and error (the error_code, or null).",
        ),
        tool(
          "get_warehouse_error_details",
          "Get detailed error code and text for a specific warehouse order.",
          "A fulfillment order id and a warehouse order id.",
          "code and text describing the warehouse error (null/null if none).",
        ),
        task({
          name: "Cancellation reason + warehouse status",
          prompt:
            "For trade order T1001, what was the stated reason for the cancellation of fulfillment order FO2001, and what is the current status of its associated warehouse order WO3001?",
          format:
            "Use the tools to find the answer, then report the cancellation reason and the warehouse order status.",
          good: [
            "Starts from query_buyer_and_related('T1001') to find FO2001 and WO3001.",
            "Finds FO2001 is cancelled, then calls get_cancel_error_code to get the reason: the wrong size was received, so the buyer cancelled and reordered.",
            "Reports WO3001's status as packing_in_progress.",
          ],
          bad: [
            "States a cancellation reason without calling the cancellation tools.",
            "Reports the wrong warehouse status.",
          ],
        }),
        task({
          name: "Aggregate multi-warehouse status",
          prompt:
            "Trade order T1002 has fulfillment orders whose warehouse orders are in different states (some delivered, some dispatched, some still packing). What is the overall status of each fulfillment order, and why?",
          format:
            "Inspect each fulfillment and its warehouse orders with the tools, then explain the rollup.",
          good: [
            "Calls get_fulfillment_status for each fulfillment under T1002.",
            "Explains the aggregate is in_transit because at least one warehouse order is in transit while others are not yet delivered.",
            "Does not report 'delivered' just because one warehouse order is delivered.",
          ],
          bad: [
            "Reports 'delivered' because a single warehouse order is delivered.",
            "Reads only one warehouse order and ignores the rollup rules.",
          ],
        }),
        task({
          name: "Cancellation diagnostics (single choice)",
          prompt:
            "A customer reports their order cannot be canceled. You confirm: the order is not already canceled, there is no prior cancellation attempt, and it is in a high-priority fulfillment flow where stock has been reserved for picking/packing. What is the appropriate next diagnostic action?\n\nA) Review the general cancellation and exception criteria for this fulfillment flow\nB) Check for current operational constraints and confirm inventory reservation/availability data is updating correctly\nC) Inspect available technical error details or audit history for order-change attempts\nD) Tell the customer high-priority orders cannot be canceled once stock is reserved",
          format: "Answer with the single best option letter and a one-line justification.",
          good: [
            "Chooses B.",
            "Justifies it: with stock reserved in a fast-moving stage, cancellation blocks usually come from temporary operational constraints or inventory-sync issues, which should be checked first.",
          ],
          bad: [
            "Chooses D and concludes cancellation is prohibited without checking.",
            "Picks an option that doesn't identify the immediate cause.",
          ],
        }),
        task({
          name: "Verification step (true/false)",
          prompt:
            "During peak operations, if an urgent order hits a warehouse-assignment exception after allocation, is it acceptable to bypass the standard initial verification step and move directly to expedited resolution to save time?",
          format: "Answer true or false with a one-line reason.",
          good: [
            "Answers false.",
            "Notes the initial verification step (confirming system and inventory status) is required even for urgent orders, to avoid acting on bad information.",
          ],
          bad: [
            "Answers true.",
            "Allows skipping verification to save time.",
          ],
        }),
        train(
          "qwen3-32b",
          2000,
          "More questions answered with correct tool chains and accurate structured answers (right cancellation reasons, error codes, and rolled-up statuses) with fewer skipped or hallucinated tool calls.",
        ),
      ]),
  },
  {
    key: "wordle-solver",
    title: "Wordle Solver",
    blurb: "Guess a hidden five-letter word in six tries using green/yellow/gray feedback.",
    tag: "Game",
    color: "#4F8A5B",
    build: () =>
      doc("Wordle Solver", [
        environment(
          "Train an agent to solve Wordle: guess a hidden five-letter word within six tries using per-letter feedback.",
          "The hidden word is fixed for each episode. After every guess the agent gets feedback for each letter, then guesses again until it solves or runs out of tries.",
        ),
        tool(
          "guess",
          "Submit a five-letter guess and get back per-letter feedback.",
          "A five-letter English word, e.g. 'crane'.",
          "Feedback per letter: green (right spot), yellow (in the word, wrong spot), or gray (not in the word).",
        ),
        task({
          name: "Solve from a start",
          prompt:
            "The hidden word has five letters. Your first guess 'crane' returns: c=gray, r=yellow, a=gray, n=gray, e=green. Find the word.",
          format: "Reason step by step, then submit each guess with the guess tool.",
          good: [
            "Keeps the 'r' and the final 'e'; drops c, a, and n.",
            "Solves within the remaining guesses.",
          ],
          bad: ["Reuses gray letters.", "Ignores that 'e' is locked in the last spot."],
        }),
        task({
          name: "Solve a fresh board",
          prompt:
            "Solve today's Wordle. You have six guesses and may start from any valid five-letter word.",
          format: "Use the guess tool each turn and adapt to the feedback.",
          good: [
            "Opens with a vowel-rich word to gather information.",
            "Narrows down with the feedback and solves in six guesses or fewer.",
          ],
          bad: ["Repeats a previous guess.", "Submits words that aren't five letters."],
        }),
        train(
          "qwen3-14b",
          1000,
          "Solves more boards in fewer guesses, without wasting turns on impossible words.",
        ),
      ]),
  },
  {
    key: "math-word-problems",
    title: "Math Word Problems",
    blurb: "Solve grade-school word problems with a calculator tool for the arithmetic.",
    tag: "Reasoning + tools",
    color: "#B07D2A",
    build: () =>
      doc("Math Word Problems", [
        environment(
          "Solve grade-school math word problems, using a calculator for the arithmetic.",
          "Each prompt is a short word problem with a single numeric answer. The agent may call the calculator as many times as it needs, then states the final number.",
        ),
        tool(
          "calculator",
          "Evaluate an arithmetic expression and return the number.",
          "An expression such as '12 * (3 + 4)'.",
          "The numeric result of the expression.",
        ),
        task({
          name: "Apples left",
          prompt:
            "A store has 12 baskets with 9 apples each, then sells 35 apples. How many apples are left?",
          format: "Show the steps, then give the final number.",
          good: ["Computes 12 × 9 − 35 = 73.", "Final answer is 73."],
          bad: ["Forgets to subtract the sold apples.", "Makes an arithmetic slip."],
        }),
        task({
          name: "Trains meeting",
          prompt:
            "Two trains start 300 km apart and head toward each other at 60 and 90 km/h. After how many hours do they meet?",
          format: "Show the reasoning, then give the answer in hours.",
          good: ["Adds the speeds to 150 km/h and divides 300 ÷ 150.", "Answer is 2 hours."],
          bad: ["Uses only one train's speed.", "Reports the wrong unit or number."],
        }),
        task({
          name: "Checkout discount",
          prompt:
            "An $80 jacket is 25% off, and then $5 is taken off at checkout. What is the final price?",
          format: "Show the steps, then give the final price.",
          good: ["Computes 80 × 0.75 = 60, then 60 − 5 = 55.", "Answer is $55."],
          bad: ["Applies the discounts in the wrong order.", "Final price isn't $55."],
        }),
        train(
          "qwen3-14b",
          1000,
          "More exact final answers, with correct multi-step arithmetic and sensible tool use.",
        ),
      ]),
  },
  {
    key: "support-triage",
    title: "Support Ticket Triage",
    blurb: "Route customer messages to the right queue and priority, with an order lookup.",
    tag: "Classification",
    color: "#9C4A55",
    build: () =>
      doc("Support Ticket Triage", [
        environment(
          "Route incoming customer support messages to the right queue and priority.",
          "Each prompt is a customer message. The agent picks a queue (Billing, Technical, Account, or Other) and a priority (Low, Normal, or Urgent), and may look up the order to decide.",
        ),
        tool(
          "lookup_order",
          "Fetch the status of a customer's order by id.",
          "An order id such as 'A-10293'.",
          "Order status (placed, shipped, delivered, or refunded) and the order date.",
        ),
        task({
          name: "Double charge",
          prompt:
            "Customer: 'I was charged twice for order A-10293 and need one charge refunded today.'",
          format: "Reply with: queue, priority, and a one-line reason.",
          good: [
            "Routes to Billing.",
            "Marks priority Urgent.",
            "Looks up the order before deciding.",
          ],
          bad: ["Routes to Technical.", "Marks the refund as Low priority."],
        }),
        task({
          name: "Login trouble",
          prompt:
            "Customer: 'I can't log in. The password reset email never arrives.'",
          format: "Reply with: queue, priority, and a one-line reason.",
          good: ["Routes to Account or Technical.", "Uses Normal priority unless it's blocking work."],
          bad: ["Routes to Billing.", "Marks Urgent with no stated cause."],
        }),
        task({
          name: "Happy feedback",
          prompt: "Customer: 'Just wanted to say the new dashboard is great!'",
          format: "Reply with: queue, priority, and a one-line reason.",
          good: ["Routes to Other / Feedback.", "Marks Low priority."],
          bad: ["Opens an Urgent support ticket.", "Routes it to Billing or Technical."],
        }),
        train(
          "qwen3-8b",
          800,
          "More messages land in the correct queue and priority, with fewer urgent mislabels.",
        ),
      ]),
  },
];
