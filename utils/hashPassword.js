const bcrypt = require("bcrypt");

async function generateHash() {

  const hash =
    await bcrypt.hash(
      "Admin@123",
      10
    );

  console.log(hash);
}

generateHash();