"use client";
import React, { useEffect, useState } from "react";
import { fetchUserDetails } from "@/lib/userService";

const UserDetails = () => {
  const [userDetails, setUserDetails] = useState(null);

  useEffect(() => {
    const getUserDetails = async () => {
      const data = await fetchUserDetails();
      setUserDetails(data);
    };
    getUserDetails();
  }, []);

  if (!userDetails) {
    return <div>Loading...</div>;
  }

  return (
    <div className="user-details-container">
      <h1>User Details</h1>
      <div className="user-details">
        <p><strong>Name:</strong> {userDetails.name}</p>
        <p><strong>Email:</strong> {userDetails.email}</p>
        <p><strong>Phone:</strong> {userDetails.phone}</p>
      </div>
      <style jsx>{`
        .user-details-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #f0f2f5;
          padding: 20px;
        }
        .user-details {
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          width: 100%;
          max-width: 400px;
        }
        .user-details p {
          margin: 10px 0;
        }
      `}</style>
    </div>
  );
};

export default UserDetails;
