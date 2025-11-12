import readline from "readline";

async function run(interfaceName, consoleId) {
  try {
    const mod = await import(`./interfaces/${interfaceName}.js`);
    const argConsole = consoleId ? parseInt(consoleId, 10) : null;

    if (mod.default && typeof mod.default === "function") {
      await mod.default(argConsole);
    } else {
      console.error(
        `❌ Interface "${interfaceName}" tidak punya export default function`,
      );
    }
  } catch (err) {
    console.error(`❌ Gagal load interface '${interfaceName}':`, err.message);
  }
}

function showMenu() {
  console.log("=====================================");
  console.log("   🔧 PILIH MODE EKSEKUSI PROGRAM");
  console.log("=====================================");
  console.log("  0. Jalankan cron_update (update otomatis harian)");
  for (let i = 1; i <= 15; i++) {
    console.log(`  ${i}. Jalankan check consoleId = ${i}`);
  }
  console.log("  16. Jalankan backup data");
  console.log("=====================================");
}

function startCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  showMenu();

  rl.question("Masukkan pilihan (0–16): ", async (answer) => {
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice < 0 || choice > 16) {
      console.log(
        "⚠️ Pilihan tidak valid! Masukkan angka antara 0–16 ya~ (/'3')/",
      );
      rl.close();
      return;
    }

    if (choice === 0) {
      console.log("▶️ Menjalankan cron_update...");
      await run("cron_update");
    } else if (choice >= 1 && choice <= 15) {
      console.log(`▶️ Menjalankan check dengan consoleId=${choice}...`);
      await run("check", choice);
    } else if (choice === 16) {
      console.log("💾 Menjalankan backup data...");
      await run("backup");
    }

    rl.close();
  });
}

startCLI();
