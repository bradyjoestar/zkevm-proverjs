const fs = require("fs");
const path = require("path");
const tty = require('tty');
const version = require("../package").version;

const exportPols = require("pilcom").exportPolynomials;
const buildPoseidon = require("@0xpolygonhermez/zkevm-commonjs").getPoseidon;
const { newCommitPolsArray, compile  } = require("pilcom");


const smArith = require("./sm/sm_arith/sm_arith.js");
const smBinary = require("./sm/sm_binary.js");
const smKeccakF = require("./sm/sm_keccakf/sm_keccakf.js");
const smMain = require("./sm/sm_main/sm_main.js");
const smMemAlign = require("./sm/sm_mem_align.js");
const smMem = require("./sm/sm_mem.js");
const smNine2One = require("./sm/sm_nine2one.js");
const smPaddingKK = require("./sm/sm_padding_kk.js");
const smPaddingKKBit = require("./sm/sm_padding_kkbit/sm_padding_kkbit.js");
const smPaddingPG = require("./sm/sm_padding_pg.js");
const smPoseidonG = require("./sm/sm_poseidong.js");
const smStorage = require("./sm/sm_storage/sm_storage.js");


const fileCachePil = path.join(__dirname, "../cache-main-pil.json");

const argv = require("yargs")
    .version(version)
    .usage("main_executor <input.json> -r <rom.json> -o <proof.json> -t <test.json> -l <logs.json> -s -d [-p <main.pil>] [-P <pilconfig.json>] -u -e -v -T -c")
    .alias("o", "output")
    .alias("r", "rom")
    .alias("t", "test")
    .alias("l", "logs")
    .alias("s", "skip")
    .alias("S", "stats")
    .alias("d", "debug")
    .alias("p", "pil")
    .alias("P", "pilconfig")
    .alias("u", "unsigned")
    .alias("e", "execute")
    .alias("v", "verbose")
    .alias("T", "tracer")
    .alias("c", "counters")
    .alias("N", "stepsN")
    .alias("V", "verboseFullTracer")
    .argv;

async function run() {

    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    let inputFile;
    if (argv._.length == 0) {
        console.log("You need to specify an input file file");
        process.exit(1);
    } else if (argv._.length == 1) {
        inputFile = argv._[0];
    } else  {
        console.log("Only one input file at a time is permited");
        process.exit(1);
    }

    const romFile = typeof(argv.rom) === "string" ?  argv.rom.trim() : "rom.json";
    const outputFile = typeof(argv.output) === "string" ?  argv.output.trim() : undefined;
    const testFile = typeof(argv.test) === "string" ?  argv.test.trim() : false;
    const logsFile = typeof(argv.logs) === "string" ?  argv.output.trim() : undefined;

    const input = JSON.parse(await fs.promises.readFile(inputFile, "utf8"));
    const rom = JSON.parse(await fs.promises.readFile(romFile, "utf8"));

    let pil;
    if (argv.skip === true) {
        if (fs.existsSync(fileCachePil)) {
            pil = JSON.parse(await fs.promises.readFile(fileCachePil, "utf8"));
        } else {
            throw new Error("Cache pil file does not exist");
        }
    } else {
        let pilFile = __dirname + "/../pil/main.pil";
        if (argv.pil) {
            if (typeof(argv.pil) !== "string") {
                throw new Error("Pil file needs to be specified with pil option")
            }
            pilFile = argv.pil.trim();
        }
        console.log('compile PIL '+pilFile);

        const pilConfig = typeof(argv.pilconfig) === "string" ? JSON.parse(fs.readFileSync(argv.pilconfig.trim())) : {};

        if (argv.verbose) {
            pilConfig.verbose = true;
            if (typeof pilConfig.color === 'undefined') {
                pilConfig.color = tty.isatty(process.stdout.fd);
            }
        }

        pil = await compile(F, pilFile, null, pilConfig);
        await fs.promises.writeFile(fileCachePil, JSON.stringify(pil, null, 1) + "\n", "utf8");
    }

    const test = testFile ? JSON.parse(await fs.promises.readFile(testFile, "utf8")) : false;
    const cmPols = newCommitPolsArray(pil);
    const stats = (argv.stats === true || typeof argv.stats === 'string');
    const statsFile = typeof argv.stats === 'string' ? argv.stats.trim() : 'program.stats';

    const config = {
        test: test,
        debug: (argv.debug === true),
        debugInfo: {
            inputName: path.basename(inputFile, ".json")
        },
        unsigned: (argv.unsigned === true),
        execute: (argv.execute === true),
        tracer: (argv.tracer === true),
        counters: (argv.counters === true),
        stats,
        stepsN: (typeof argv.stepsN === 'undefined' ? undefined : argv.stepsN),
        verboseFullTracer: (argv.verboseFullTracer === true)
    }
    let metadata = {};
    const N = cmPols.Main.PC.length;

    console.log(`N = ${N}`);
    console.log("Main ...");
    const requiredMain = await smMain.execute(cmPols.Main, input, rom, config, metadata);
    if (typeof outputFile !== "undefined") {
        if (cmPols.Storage) {
            console.log("Storage...");
        }
        const requiredStorage = cmPols.Storage ? await smStorage.execute(cmPols.Storage, requiredMain.Storage) : false;

        if (cmPols.Arith) {
            console.log("Arith...");
            await smArith.execute(cmPols.Arith, requiredMain.Arith || []);
        }
        if (cmPols.Binary) {
            console.log("Binary...");
            await smBinary.execute(cmPols.Binary, requiredMain.Binary || []);
        }
        if (cmPols.MemAlign) {
            console.log("MemAlign...");
            await smMemAlign.execute(cmPols.MemAlign, requiredMain.MemAlign || []);
        }
        if (cmPols.Mem) {
            console.log("Mem...");
            await smMem.execute(cmPols.Mem, requiredMain.Mem || []);
        }
        if (cmPols.PaddingKK) console.log("PaddingKK...");
        const requiredKK = cmPols.PaddingKK ? await smPaddingKK.execute(cmPols.PaddingKK, requiredMain.PaddingKK || []) : false;

        if (cmPols.PaddingKKBit) console.log("PaddingKKbit...");
        const requiredKKBit = cmPols.PaddingKKBit ? await smPaddingKKBit.execute(cmPols.PaddingKKBit, requiredKK.paddingKKBit || []): false;

        if (cmPols.Nine2One) console.log("Nine2One...");
        const requiredNine2One = cmPols.Nine2One ? await smNine2One.execute(cmPols.Nine2One, requiredKKBit.Nine2One || []) : false;

        if (cmPols.KeccakF) {
            console.log("KeccakF...");
            await smKeccakF.execute(cmPols.KeccakF, requiredNine2One.KeccakF || []);
        }

        if (cmPols.PaddingPG) console.log("PaddingPG...");
        const requiredPaddingPG = cmPols.PaddingPG ? await smPaddingPG.execute(cmPols.PaddingPG, requiredMain.PaddingPG || []) : false;

        if (cmPols.PoseidonG) {
            console.log("PoseidonG...");
            const allPoseidonG = [ ...(requiredMain.PoseidonG || []), ...(requiredPaddingPG.PoseidonG || []), ...(requiredStorage.PoseidonG || []) ];
            await smPoseidonG.execute(cmPols.PoseidonG, allPoseidonG);
        }

        for (let i=0; i<cmPols.$$array.length; i++) {
            for (let j=0; j<N; j++) {
                if (typeof cmPols.$$array[i][j] === "undefined") {
                    throw new Error(`Polinomial not fited ${cmPols.$$defArray[i].name} at ${j}` )
                }
            }
        }

        console.log("Exporting Polynomials...");
        await cmPols.saveToFile(outputFile);
    }
    if (stats) {
        console.log(`generating lines info .... ${outputFile}`);
        let output = await fs.promises.open(statsFile, 'w');
        let w = 0;
        const sep = '|';
        const content = ['w', 'zkPC', 'times', 'sourceFile', 'sourceLine', 'code'].join(sep) + "\n";
        let res = await output.write(content);

        for (const zkPC of metadata.stats.trace) {
            const line = rom.program[zkPC];
            const content = [w, zkPC, metadata.stats.lineTimes[zkPC] || 0,line.fileName, line.line, line.lineStr.trim()].join('|') + "\n";
            res = await output.write(content);
            ++w;
        }
        await output.close();
    }

    if (logsFile) {
        console.log("Writing logs...");
        fs.writeFileSync(logsFile, JSON.stringify(requiredMain.Logs, null, 2));
    }

    console.log("Executor finished correctly");
}

run().then(()=> {
    process.exit(0);
}, (err) => {
    console.log(err.message);
    console.log(err.stack);
    process.exit(1);
});
