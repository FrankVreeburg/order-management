// Load environment variables
require("dotenv").config();

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
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user; // Add user info to request
    next();
  });
};

// Middleware to check if user has required role
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
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
    const ordersResult = await pool.query(`
      SELECT 
        o.id,
        o.customer_id,
        o.status,
        o.created_at,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
    `);

    // Get all order items
    const itemsResult = await pool.query(`
      SELECT 
        oi.*
      FROM order_items oi
      ORDER BY oi.order_id, oi.id
    `);

    // Group items by order_id
    const itemsByOrder = {};
    itemsResult.rows.forEach((item) => {
      if (!itemsByOrder[item.order_id]) {
        itemsByOrder[item.order_id] = [];
      }
      itemsByOrder[item.order_id].push(item);
    });

    // Combine orders with their items
    const ordersWithItems = ordersResult.rows.map((order) => ({
      ...order,
      items: itemsByOrder[order.id] || [],
    }));

    res.json(ordersWithItems);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// POST /orders - creates a new order with multiple items
app.post("/orders", authenticateToken, async (req, res) => {
  const { customerId, items } = req.body;

  // Validation
  if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ error: "Customer ID and at least one item are required" });
  }

  try {
    // Start a transaction (ensures all-or-nothing: either order is created AND stock updated, or neither happens)
    await pool.query("BEGIN");

    // Verify customer exists
    const customerResult = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [customerId],
    );

    if (customerResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customerResult.rows[0];

    // Create the order
    const orderResult = await pool.query(
      `INSERT INTO orders (customer_id, customer_name, status, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [customerId, customer.name, "pending"],
    );

    const order = orderResult.rows[0];

    // Process each item
    const orderItems = [];
    for (const item of items) {
      const { productId, quantity } = item;

      if (!productId || !quantity || quantity <= 0) {
        await pool.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Invalid item: productId and quantity > 0 required" });
      }

      // Get product and lock for update
      const productResult = await pool.query(
        "SELECT * FROM products WHERE id = $1 FOR UPDATE",
        [productId],
      );

      if (productResult.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: `Product not found: ${productId}` });
      }

      const product = productResult.rows[0];

      // Check stock
      if (product.stock < quantity) {
        await pool.query("ROLLBACK");
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${quantity}`,
        });
      }

      // Create order item
      const itemResult = await pool.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_order, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *`,
        [order.id, productId, product.name, quantity, product.price || 0],
      );

      orderItems.push(itemResult.rows[0]);

      // Update product stock
      await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
        quantity,
        productId,
      ]);
    }

    await pool.query("COMMIT");

    // Return order with items
    res.status(201).json({
      ...order,
      items: orderItems,
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// GET /orders/:id - get single order with items
app.get("/orders/:id", authenticateToken, async (req, res) => {
  const orderId = parseInt(req.params.id);

  try {
    // Get order
    const orderResult = await pool.query(
      `
      SELECT 
        o.*,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.id = $1
    `,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Get order items
    const itemsResult = await pool.query(
      `
      SELECT * FROM order_items WHERE order_id = $1 ORDER BY id
    `,
      [orderId],
    );

    res.json({
      ...orderResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch order" });
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
    const result = await pool.query(`
      SELECT 
        w.*,
        u.username,
        u.email as user_email
      FROM workers w
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch workers" });
  }
});

// POST /workers - create a new worker
app.post("/workers", authenticateToken, async (req, res) => {
  const { name, email, role, phone, userId } = req.body;

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

    // If userId provided, verify user exists and isn't already linked
    if (userId) {
      const userCheck = await pool.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user is already linked to another worker
      const existingLink = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1",
        [userId],
      );

      if (existingLink.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "User already linked to another worker" });
      }
    }

    // Create new worker
    const result = await pool.query(
      `INSERT INTO workers (name, email, role, phone, active, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, email, role || "Picker", phone || "", true, userId || null],
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
  const { name, email, role, phone, active, userId } = req.body;

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

    // If userId is being changed, verify user exists and isn't already linked
    if (userId !== undefined && userId !== null) {
      const userCheck = await pool.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user is already linked to another worker
      const existingLink = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1 AND id != $2",
        [userId, workerId],
      );

      if (existingLink.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "User already linked to another worker" });
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
    if (userId !== undefined) {
      // Allow setting to null to unlink
      updates.push(`user_id = $${paramCount++}`);
      values.push(userId);
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

    await pool.query(query, values);

    // Fetch the updated worker WITH user info (using JOIN)
    const result = await pool.query(
      `
      SELECT 
        w.*,
        u.username,
        u.email as user_email
      FROM workers w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.id = $1
    `,
      [workerId],
    );

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
app.delete(
  "/workers/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      // Check if user is linked to a worker
      const linkedWorker = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1",
        [userId],
      );

      if (linkedWorker.rows.length > 0) {
        return res.status(400).json({
          error: `Cannot delete user. Linked to worker: ${linkedWorker.rows[0].name}. Unlink the worker first.`,
        });
      }

      const result = await pool.query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "User deleted successfully", id: userId });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

// ===== CUSTOMER ENDPOINTS =====

// GET /customers - Get all customers
app.get("/customers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

// GET /customers/:id/orders - Get all orders for a specific customer
app.get("/customers/:id/orders", authenticateToken, async (req, res) => {
  const customerId = parseInt(req.params.id);

  try {
    // Get customer info
    const customerResult = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [customerId],
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Get all orders for this customer
    const ordersResult = await pool.query(
      `
      SELECT 
        o.*
      FROM orders o
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC
    `,
      [customerId],
    );

    // Get order items for all these orders
    if (ordersResult.rows.length > 0) {
      const orderIds = ordersResult.rows.map((o) => o.id);
      const itemsResult = await pool.query(
        `
        SELECT * FROM order_items 
        WHERE order_id = ANY($1)
        ORDER BY order_id, id
      `,
        [orderIds],
      );

      // Group items by order_id
      const itemsByOrder = {};
      itemsResult.rows.forEach((item) => {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = [];
        }
        itemsByOrder[item.order_id].push(item);
      });

      // Combine orders with their items
      const ordersWithItems = ordersResult.rows.map((order) => ({
        ...order,
        items: itemsByOrder[order.id] || [],
      }));

      res.json({
        customer: customerResult.rows[0],
        orders: ordersWithItems,
      });
    } else {
      res.json({
        customer: customerResult.rows[0],
        orders: [],
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch customer orders" });
  }
});

// POST /customers - Create new customer
app.post("/customers", authenticateToken, async (req, res) => {
  const { name, email, phone, company, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Customer name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, email, phone, company, address)
      VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, email || null, phone || null, company || null, address || null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// PATCH /customers/:id - Update customer
app.patch("/customers/:id", authenticateToken, async (req, res) => {
  const customerId = parseInt(req.params.id);
  const { name, email, phone, company, address } = req.body;

  try {
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
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (company !== undefined) {
      updates.push(`company = $${paramCount++}`);
      values.push(company);
    }
    if (address !== undefined) {
      updates.push(`address = $${paramCount++}`);
      values.push(address);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(customerId);

    const query = `
      UPDATE customers 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// ===== USER MANAGEMENT ENDPOINTS (Admin only) =====

// GET /users - Get all users (admin only)
app.get("/users", authenticateToken, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role, created_at FROM users ORDER BY id",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// PATCH /users/:id - Update user (admin only)
app.patch(
  "/users/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);
    const { username, email, role } = req.body;

    try {
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (username !== undefined) {
        updates.push(`username = $${paramCount++}`);
        values.push(username);
      }
      if (email !== undefined) {
        updates.push(`email = $${paramCount++}`);
        values.push(email);
      }
      if (role !== undefined) {
        updates.push(`role = $${paramCount++}`);
        values.push(role);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      values.push(userId);

      const query = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, username, email, role, created_at
    `;

      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

// DELETE /users/:id - Delete user (admin only)
app.delete(
  "/users/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      const result = await pool.query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "User deleted successfully", id: userId });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

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
