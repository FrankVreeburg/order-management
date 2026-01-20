// Import Express - the framework for building our web server
const express = require("express");

// Import CORS - allows our frontend (different port) to access this backend
const cors = require("cors");

// Connect to Database PG
const { Pool } = require("pg");

// Database connection
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "order_management",
  password: "+76edRFT(//!@ds", // ← Change this to your actual password
  port: 5432,
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

// In-memory storage (data disappears when server restarts - we'll fix this with a database later)
let orders = [];
let products = [
  {
    id: 1,
    name: "Widget A",
    stock: 100,
    eanCode: "8712345678901",
    description: "High-quality widget for industrial use",
    category: "Widgets",
    supplier: "ABC Supplies",
    price: 29.99,
    minStock: 20,
  },
  {
    id: 2,
    name: "Widget B",
    stock: 50,
    eanCode: "8712345678902",
    description: "Compact widget for light-duty applications",
    category: "Widgets",
    supplier: "XYZ Corp",
    price: 19.99,
    minStock: 10,
  },
];
let workers = [
  {
    id: 1,
    name: "John Smith",
    email: "john@example.com",
    role: "Picker",
    phone: "555-0101",
    active: true,
  },
  {
    id: 2,
    name: "Jane Doe",
    email: "jane@example.com",
    role: "Supervisor",
    phone: "555-0102",
    active: true,
  },
];

// ===== API ENDPOINTS =====

// GET /products - returns list of all products with current stock levels
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /products - creates a new product
app.post("/products", async (req, res) => {
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
app.patch("/products/:id", async (req, res) => {
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
app.get("/orders", async (req, res) => {
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
app.post("/orders", async (req, res) => {
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
app.patch("/orders/:id", (req, res) => {
  const orderId = parseInt(req.params.id); // Get order ID from URL
  const { status } = req.body; // Get new status from request body

  // Find the order
  const order = orders.find((o) => o.id === orderId);

  // Check if order exists
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Update the status
  order.status = status;

  // Send back the updated order
  res.json(order);
});

// ===== WORKER ENDPOINTS =====

// GET /workers - get all workers
app.get("/workers", (req, res) => {
  res.json(workers);
});

// POST /workers - create a new worker
app.post("/workers", (req, res) => {
  const { name, email, role, phone } = req.body;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Check if email already exists
  if (workers.find((w) => w.email === email)) {
    return res.status(400).json({ error: "Email already exists" });
  }

  const newWorker = {
    id: workers.length > 0 ? Math.max(...workers.map((w) => w.id)) + 1 : 1,
    name,
    email,
    role: role || "Picker",
    phone: phone || "",
    active: true,
  };

  workers.push(newWorker);
  res.status(201).json(newWorker);
});

// PATCH /workers/:id - update a worker
app.patch("/workers/:id", (req, res) => {
  const workerId = parseInt(req.params.id);
  const { name, email, role, phone, active } = req.body;

  const worker = workers.find((w) => w.id === workerId);

  if (!worker) {
    return res.status(404).json({ error: "Worker not found" });
  }

  // Check email uniqueness if changing email
  if (email && email !== worker.email) {
    if (workers.find((w) => w.email === email && w.id !== workerId)) {
      return res.status(400).json({ error: "Email already exists" });
    }
  }

  // Update fields
  if (name !== undefined) worker.name = name;
  if (email !== undefined) worker.email = email;
  if (role !== undefined) worker.role = role;
  if (phone !== undefined) worker.phone = phone;
  if (active !== undefined) worker.active = active;

  res.json(worker);
});

// DELETE /workers/:id - delete a worker
app.delete("/workers/:id", (req, res) => {
  const workerId = parseInt(req.params.id);
  const index = workers.findIndex((w) => w.id === workerId);

  if (index === -1) {
    return res.status(404).json({ error: "Worker not found" });
  }

  workers.splice(index, 1);
  res.json({ message: "Worker deleted successfully", id: workerId });
});

// Start the server and listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});
