"use client"; // Enables client-side rendering for this component
import React, { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import Confetti from "react-confetti";

export default function Login() {
  const [formData, setFormData] = useState({
    Email: "",
    Password: "",
  });

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const router = useRouter();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const response = await axios.post(
        "https://click-to-dial-3252.twil.io/login-user",
        formData
      );

      const { token, userDetails } = response.data;

      // Save the token and user details to localStorage
      localStorage.setItem("authToken", token);
      localStorage.setItem("userDetails", JSON.stringify(userDetails));

      setSuccess(response.data.message);
      setShowConfetti(true);

      // Redirect to the main page after a short delay
      setTimeout(() => {
        router.push("/");
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || "An error occurred.");
    }
  };

  return (
    <div className="login-container">
      {showConfetti && <Confetti />}
      <div className="login-box">
        <img src="/InsightCallGeniusAI.svg" alt="InsightCallGeniusAI Logo" className="logo" />
        <h1>Login</h1>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            name="Email"
            placeholder="Email"
            value={formData.Email}
            onChange={handleChange}
            required
          />
          <input
            type="password"
            name="Password"
            placeholder="Password"
            value={formData.Password}
            onChange={handleChange}
            required
          />
          <button type="submit">Login</button>
        </form>
        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}
        <p>
          Don&apos;t have an account? <a href="/auth/register">Register here</a>
        </p>
        <p>
          <a href="/icg-call-plugin.msi" download>Download the ICG Call Plugin</a>
        </p>
      </div>
      <style jsx>{`
        .login-container {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background-color: #f0f2f5;
        }
        .login-box {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          text-align: center;
          max-width: 400px;
          width: 100%;
        }
        .logo {
          width: 150px;
          display: block;
          margin: 0 auto 20px;
          opacity: 0.7;
        }
        input {
          display: block;
          width: 100%;
          margin: 10px 0;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        button {
          width: 100%;
          padding: 10px;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:hover {
          background-color: #0056b3;
        }
        .error-message {
          color: red;
        }
        .success-message {
          color: green;
        }
        a {
          color: inherit;
          text-decoration: none;
        }
        a:hover {
          color: red;
        }
      `}</style>
    </div>
  );
}