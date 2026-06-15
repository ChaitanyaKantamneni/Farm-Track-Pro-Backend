const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("FarmTrack Pro API Running");
});

const authRoutes =
require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const tenantRoutes =
require("./routes/tenantRoutes");
app.use("/api/tenants",tenantRoutes);

const farmRoutes =
require("./routes/farmRoutes");
app.use("/api/farm", farmRoutes);

const disposalRoutes = require("./routes/disposalRoutes");
app.use("/api/inventory", disposalRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server Running On Port ${PORT}`
  );
});
