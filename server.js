// Load environment variables
require('dotenv').config();

// Import Express - the framework for building our web server
const express = require("express");

// Import CORS - allows our frontend (different port) to access this backend
const cors = require("cors");

// Connect to Database PG
const { Pool } = require("pg");

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error("❌ Database connection error:", err);
  } else {
    console.log("✅ Connected to PostgreSQL database");
  }
});

// Create an Express application - this is your web server
const app = express();

// Middleware: tells Express to understand JSON data in requests
app.use(express.json());

// Middleware: enables Cross-Origin Resource Sharing
// This allows our React app (localhost:3001) to fetch data from this API (localhost:3000)
app.use(cors());

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  const jwt = require("jsonwebtoken");
  jwt.verify(
    token,
    process.env.JWT_SECRET,
    (err, user) => {
      if (err) {
        return res.status(403).json({ error: "Invalid or expired token" });
      }
      req.user = user; // Add user info to request
      next();
    },
  );
};

// GET /auth/verify - Verify if token is still valid
app.get("/auth/verify", authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user,
  });
});

// ===== API ENDPOINTS =====

// GET /products - returns list of all products with current stock levels
app.get("/products", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /products - creates a new product
app.post("/products", authenticateToken, async (req, res) => {
  const {
    name,
    stock,
    eanCode,
    description,
    category,
    supplier,
    price,
    minStock,
  } = req.body;

  // Validation
  if (!name || stock === undefined) {
    return res.status(400).json({ error: "Name and stock are required" });
  }

  if (stock < 0) {
    return res.status(400).json({ error: "Stock cannot be negative" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (name, stock, ean_code, description, category, supplier, price, min_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        parseInt(stock),
        eanCode || "",
        description || "",
        category || "",
        supplier || "",
        price ? parseFloat(price) : 0,
        minStock ? parseInt(minStock) : 0,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

// PATCH /products/:id - updates a product
app.patch("/products/:id", authenticateToken, async (req, res) => {
  const productId = parseInt(req.params.id);
  const {
    stock,
    name,
    eanCode,
    description,
    category,
    supplier,
    price,
    minStock,
  } = req.body;

  try {
    // Build dynamic UPDATE query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (stock !== undefined && stock !== "") {
      const parsedStock = parseInt(stock);
      if (isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ error: "Invalid stock value" });
      }
      updates.push(`stock = $${paramCount++}`);
      values.push(parsedStock);
    }

    if (name !== undefined && name !== "") {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (eanCode !== undefined) {
      updates.push(`ean_code = $${paramCount++}`);
      values.push(eanCode || null);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description || null);
    }

    if (category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(category || null);
    }

    if (supplier !== undefined) {
      updates.push(`supplier = $${paramCount++}`);
      values.push(supplier || null);
    }

    if (price !== undefined && price !== "") {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ error: "Invalid price value" });
      }
      updates.push(`price = $${paramCount++}`);
      values.push(parsedPrice);
    }

    if (minStock !== undefined && minStock !== "") {
      const parsedMinStock = parseInt(minStock);
      if (isNaN(parsedMinStock) || parsedMinStock < 0) {
        return res.status(400).json({ error: "Invalid minStock value" });
      }
      updates.push(`min_stock = $${paramCount++}`);
      values.push(parsedMinStock);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Add productId as the last parameter
    values.push(productId);

    const query = `
      UPDATE products 
      SET ${updates.join(", ")} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// GET /orders - returns list of all orders
app.get("/orders", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// POST /orders - creates a new order
app.post("/orders", authenticateToken, async (req, res) => {
  const { productId, quantity, customerName } = req.body;

  // Validation
  if (!productId || !quantity || !customerName) {
    return res
      .status(400)
      .json({ error: "Product ID, quantity, and customer name are required" });
  }

  try {
    // Start a transaction (ensures all-or-nothing: either order is created AND stock updated, or neither happens)
    await pool.query("BEGIN");

    // Find the product and lock it for update
    const productResult = await pool.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [productId],
    );

    if (productResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }

    const product = productResult.rows[0];

    // Check stock
    if (product.stock < quantity) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient stock" });
    }

    // Create the order
    const orderResult = await pool.query(
      `INSERT INTO orders (product_id, product_name, quantity, customer_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [productId, product.name, quantity, customerName, "pending"],
    );

    // Update product stock
    await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
      quantity,
      productId,
    ]);

    // Commit the transaction
    await pool.query("COMMIT");

    res.status(201).json(orderResult.rows[0]);
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// PATCH /orders/:id - updates an order's status
app.patch("/orders/:id", authenticateToken, async (req, res) => {
  const orderId = parseInt(req.params.id);
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const result = await pool.query(
      "UPDATE orders SET status = $1 WHERE id = $2 RETURNING *",
      [status, orderId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// ===== WORKER ENDPOINTS =====

// GET /workers - get all workers
app.get("/workers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM workers ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch workers" });
  }
});

// POST /workers - create a new worker
app.post("/workers", authenticateToken, async (req, res) => {
  const { name, email, role, phone } = req.body;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  try {
    // Check if email already exists
    const existingWorker = await pool.query(
      "SELECT * FROM workers WHERE email = $1",
      [email],
    );

    if (existingWorker.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Create new worker
    const result = await pool.query(
      `INSERT INTO workers (name, email, role, phone, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, email, role || "Picker", phone || "", true],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create worker" });
  }
});

// PATCH /workers/:id - update a worker
app.patch("/workers/:id", authenticateToken, async (req, res) => {
  const workerId = parseInt(req.params.id);
  const { name, email, role, phone, active } = req.body;

  try {
    // Check if email is being changed and if it already exists
    if (email) {
      const existingWorker = await pool.query(
        "SELECT * FROM workers WHERE email = $1 AND id != $2",
        [email, workerId],
      );

      if (existingWorker.rows.length > 0) {
        return res.status(400).json({ error: "Email already exists" });
      }
    }

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramCount++}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(workerId);

    const query = `
      UPDATE workers 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update worker" });
  }
});

// DELETE /workers/:id - delete a worker
app.delete("/workers/:id", authenticateToken, async (req, res) => {
  const workerId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      "DELETE FROM workers WHERE id = $1 RETURNING *",
      [workerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    res.json({ message: "Worker deleted successfully", id: workerId });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to delete worker" });
  }
});

// ===== AUTHENTICATION ENDPOINTS =====

// POST /auth/register - Create new user account
app.post("/auth/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  // Validation
  if (!username || !email || !password) {
    return res
      .status(400)
      .json({ error: "Username, email, and password are required" });
  }

  if (password.length < 9) {
    return res
      .status(400)
      .json({ error: "Password must be at least 9 characters" });
  }

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username],
    );

    if (existingUser.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Email or username already exists" });
    }

    // Hash the password
    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash, role || "user"],
    );

    res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// POST /auth/login - Login user
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Find user
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // Check password
    const bcrypt = require("bcryptjs");
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Create JWT token
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Start the server and listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});
