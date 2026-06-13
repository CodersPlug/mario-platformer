using TMPro;
using UnityEngine;

public class UIManager : MonoBehaviour
{
    public static UIManager Instance { get; private set; }

    [SerializeField] TextMeshProUGUI coinsLabel;
    [SerializeField] TextMeshProUGUI livesLabel;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
    }

    public void UpdateCoins(int count)
    {
        coinsLabel.text = $"Coins: {count}";
    }

    public void UpdateLives(int count)
    {
        livesLabel.text = $"Lives: {count}";
    }
}
