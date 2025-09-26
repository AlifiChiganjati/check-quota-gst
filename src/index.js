import readline from "readline";

async function run(interfaceName, consoleId) {
  try {
    const mod = await import(`./interfaces/${interfaceName}.js`);
    const argConsole = consoleId ? parseInt(consoleId, 10) : null;

    if (mod.default && typeof mod.default === "function") {
      await mod.default(argConsole); // jalankan interface
    } else {
      console.error(
        `❌ Interface "${interfaceName}" tidak punya export default function`,
      );
    }
  } catch (err) {
    console.error(`❌ Gagal load interface '${interfaceName}':`, err.message);
  }
}

const interfaceName = process.argv[2];
const consoleId = process.argv[3];

// Kalau user kasih argumen → langsung jalan
if (interfaceName) {
  run(interfaceName, consoleId);
} else {
  // Kalau kosong → mode interaktif
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Masukkan nama interface (check / cron_update): ", (iname) => {
    rl.question("Masukkan consoleId: ", (cid) => {
      run(iname, cid);
      rl.close();
    });
  });
}
