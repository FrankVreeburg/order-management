// Import Express - think of this like grabbing a tool from your toolbox
const express = require("express");

// Create an Express application - this is your web server
const app = express();

// This tells Express to understand JSON data in requests
// (orders will be sent as JSON)
app.use(express.json());

// In-memory storage for now (we'll use a real database later)
// Think of this as a temporary notepad
let orders = [];
let products = [
  { id: 1, name: "Widget A", stock: 100 },
  { id: 2, name: "Widget B", stock: 50 },
];

// ===== ENDPOINTS (these are like different doors into your system) =====

// GET all products - see what's available
app.get("/products", (req, res) => {
  res.json(products);
});

// GET all orders - see order history
app.get("/orders", (req, res) => {
  res.json(orders);
});

// POST create a new order - this is where the magic happens!
app.post("/orders", (req, res) => {
  const { productId, quantity, customerName } = req.body;

  // Find the product
  const product = products.find((p) => p.id === productId);

  // Check if product exists
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  // Check if enough stock
  if (product.stock < quantity) {
    return res.status(400).json({ error: "Insufficient stock" });
  }

  // Create the order
  const newOrder = {
    id: orders.length + 1,
    productId,
    productName: product.name,
    quantity,
    customerName,
    status: "pending",
    createdAt: new Date(),
  };

  // Reduce stock
  product.stock -= quantity;

  // Save order
  orders.push(newOrder);

  res.status(201).json(newOrder);
});

// Start the server on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});
