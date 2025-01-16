"use client";
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import Confetti from "react-confetti";

export default function Register() {
  const [companyData, setCompanyData] = useState({
    GHToken: "",
    CompanyName: "",
    FriendlyName: "",
    Address1: "",
    Address2: "",
    City: "",
    State: "",
    ZipCode: "",
  });

  const [userData, setUserData] = useState({
    GHUserId: "",
    FirstName: "",
    LastName: "",
    Email: "",
    Password: "",
    ConfirmPassword: "",
    OutboundNumber: "",
  });

  const [glassHiveUsers, setGlassHiveUsers] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [passwordStrength, setPasswordStrength] = useState("Weak");
  const [passwordStrengthValue, setPasswordStrengthValue] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Clear email and password fields to prevent auto-filling
    setUserData((prevData) => ({
      ...prevData,
      Email: "",
      Password: "",
      ConfirmPassword: "",
    }));
  }, []);

  const handleCompanyChange = (e) => {
    setCompanyData({ ...companyData, [e.target.name]: e.target.value });
  };

  const handleUserChange = (e) => {
    setUserData({ ...userData, [e.target.name]: e.target.value });
  };

  const handleGHUserChange = (e) => {
    const selectedUserId = e.target.value;
    const selectedUser = glassHiveUsers.find((user) => user.Id === selectedUserId);
    setUserData((prevData) => ({
      ...prevData,
      GHUserId: selectedUserId,
      FirstName: selectedUser?.FirstName || "",
      LastName: selectedUser?.LastName || "",
      Email: selectedUser?.Email || "",
    }));
  };

  const handleFetchGlassHiveUsers = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await axios.post(
        "https://click-to-dial-3252.twil.io/get-glasshive-users",
        { GHToken: companyData.GHToken }
      );
      setGlassHiveUsers(response.data.users);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch GlassHive users.");
    }
  };

  const handlePasswordChange = (e) => {
    const password = e.target.value;
    setUserData({ ...userData, Password: password });
    if (password.length < 6) {
      setPasswordStrength("Weak");
      setPasswordStrengthValue(1);
    } else if (password.length < 10) {
      setPasswordStrength("Fair");
      setPasswordStrengthValue(2);
    } else {
      setPasswordStrength("Strong");
      setPasswordStrengthValue(3);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const companyResponse = await axios.post(
        "https://click-to-dial-3252.twil.io/create-company",
        companyData
      );
      const companyId = companyResponse.data?.CustomerId;
      if (!companyId) throw new Error("CompanyId not returned from create-company.");

      const userResponse = await axios.post(
        "https://click-to-dial-3252.twil.io/create-user",
        { ...userData, CompanyId: companyId, GHToken: companyData.GHToken }
      );
      setSuccess(userResponse.data.message);
      setShowConfetti(true);

      // Redirect to the login page after a short delay
      setTimeout(() => {
        router.push("/auth/login");
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || "An error occurred.");
    }
  };

  return (
    <div className="register-container">
      {showConfetti && <Confetti />}
      <div className="register-box">
        <img src="/InsightCallGeniusAI.svg" alt="InsightCallGeniusAI Logo" className="logo" />
        <h1>Register</h1>
        <form onSubmit={handleSubmit}>
          <h3>Company Details</h3>
          <input
            type="text"
            name="GHToken"
            placeholder="GlassHive Token"
            value={companyData.GHToken}
            onChange={handleCompanyChange}
            required
          />
          <button type="button" onClick={handleFetchGlassHiveUsers}>
            Fetch GlassHive Users
          </button>

          {glassHiveUsers.length > 0 && (
            <select
              name="GHUserId"
              value={userData.GHUserId}
              onChange={handleGHUserChange}
              required
            >
              <option value="" disabled>
                Select GlassHive User
              </option>
              {glassHiveUsers.map((user) => (
                <option key={user.Id} value={user.Id}>
                  {user.FirstName} {user.LastName}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            name="CompanyName"
            placeholder="Company Name"
            value={companyData.CompanyName}
            onChange={handleCompanyChange}
            required
          />
          <input
            type="text"
            name="FriendlyName"
            placeholder="Friendly Name"
            value={companyData.FriendlyName}
            onChange={handleCompanyChange}
          />
          <input
            type="text"
            name="Address1"
            placeholder="Address 1"
            value={companyData.Address1}
            onChange={handleCompanyChange}
          />
          <input
            type="text"
            name="Address2"
            placeholder="Address 2"
            value={companyData.Address2}
            onChange={handleCompanyChange}
          />
          <input
            type="text"
            name="City"
            placeholder="City"
            value={companyData.City}
            onChange={handleCompanyChange}
          />
          <input
            type="text"
            name="State"
            placeholder="State"
            value={companyData.State}
            onChange={handleCompanyChange}
          />
          <input
            type="text"
            name="ZipCode"
            placeholder="Zip Code"
            value={companyData.ZipCode}
            onChange={handleCompanyChange}
          />

          <h3>User Details</h3>
          <input
            type="text"
            name="FirstName"
            placeholder="First Name"
            value={userData.FirstName}
            onChange={handleUserChange}
            required
          />
          <input
            type="text"
            name="LastName"
            placeholder="Last Name"
            value={userData.LastName}
            onChange={handleUserChange}
            required
          />
          <input
            type="email"
            name="Email"
            placeholder="Email"
            value={userData.Email || ""}
            onChange={handleUserChange}
            required
          />
          <input
            type="password"
            name="Password"
            placeholder="Password"
            value={userData.Password}
            onChange={handlePasswordChange}
            required
          />
          <p>Password Strength: {passwordStrength}</p>
          <meter value={passwordStrengthValue} min="0" max="3" low="1" high="2" optimum="3"></meter>
          <input
            type="password"
            name="ConfirmPassword"
            placeholder="Confirm Password"
            value={userData.ConfirmPassword}
            onChange={handleUserChange}
            required
          />
          <input
            type="text"
            name="OutboundNumber"
            placeholder="Outbound Number"
            value={userData.OutboundNumber}
            onChange={handleUserChange}
          />
          <button type="submit">Register</button>
        </form>
        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}
        <p>
          Already have an account? <a href="/auth/login">Login here</a>
        </p>
      </div>
      <style jsx>{`
        .register-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background-color: #f0f2f5;
          padding: 20px;
        }
        .register-box {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          text-align: center;
          max-width: 600px;
          width: 100%;
        }
        .logo {
          width: 150px;
          display: block;
          margin: 0 auto 20px;
          opacity: 0.7;
        }
        input, select, meter {
          display: block;
          width: 100%;
          margin: 10px 0;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        meter {
          height: 20px;
          width: 100%;
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